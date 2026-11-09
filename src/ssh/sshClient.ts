import { Client, ConnectConfig } from 'ssh2';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import { SSHConnectionConfig, CommandResult } from '../types/config';
import { Logger } from '../utils/logger';
import {
  algorithmsForKeyType,
  findKnownKeys,
  fingerprint,
  rememberHostKey,
  verifyHostKey,
} from './knownHosts';

/** Host key algorithms ssh2 can negotiate. */
const SUPPORTED_HOST_KEY_ALGORITHMS = new Set([
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'rsa-sha2-512',
  'rsa-sha2-256',
  'ssh-rsa',
]);

export interface Tunnel {
  /** Local port on 127.0.0.1 that forwards to the remote address */
  localPort: number;
  close(): void;
}

export class SSHClient {
  private client: Client;
  private config: SSHConnectionConfig;
  private connected: boolean = false;

  constructor(config: SSHConnectionConfig) {
    this.config = config;
    this.client = new Client();
  }

  async connect(): Promise<void> {
    const port = this.config.port || 22;
    const privateKey = this.readPrivateKey();

    // Set by the host verifier so a refused key produces a useful error.
    let hostKeyError: string | null = null;
    let keyToRemember: Buffer | null = null;

    const hostVerifier = (key: Buffer): boolean => {
      const presented = fingerprint(key);

      // 1. Explicitly pinned fingerprint in orca.yml wins.
      if (this.config.hostKey) {
        if (presented === this.config.hostKey.replace(/=+$/, '')) return true;
        hostKeyError =
          `Host key for ${this.config.host} does not match server.host_key.\n` +
          `  expected: ${this.config.hostKey}\n` +
          `  received: ${presented}\n` +
          'Someone may be intercepting the connection, or the server was reinstalled.';
        return false;
      }

      // 2. known_hosts files.
      const verdict = verifyHostKey(this.config.host, port, key);
      if (verdict.status === 'match') return true;

      if (verdict.status === 'mismatch') {
        hostKeyError =
          `HOST KEY FOR ${this.config.host} HAS CHANGED!\n` +
          `  received: ${presented}\n` +
          `  known in: ${[...new Set(verdict.known.map((k) => k.source))].join(', ')}\n` +
          'Someone may be intercepting the connection (man-in-the-middle), or the server was reinstalled.\n' +
          'If the change is expected, remove the old entry (e.g. `ssh-keygen -R <host>`) and try again.';
        return false;
      }

      // 3. Unknown host.
      if (this.config.strictHostKeyChecking) {
        hostKeyError =
          `Host key for ${this.config.host} is not known and strict_host_key_checking is on.\n` +
          `  received: ${presented}\n` +
          `Verify it, then add it with \`ssh-keyscan -p ${port} ${this.config.host} >> ~/.ssh/known_hosts\` ` +
          'or set server.host_key in orca.yml.';
        return false;
      }

      Logger.warn(`First connection to ${this.config.host}: trusting host key ${presented}`);
      keyToRemember = key;
      return true;
    };

    const connectConfig: ConnectConfig = {
      host: this.config.host,
      port,
      username: this.config.username,
      privateKey,
      hostVerifier,
      readyTimeout: 20000,
      keepaliveInterval: 15000,
    };

    // Prefer key types we already know for this host, so the server presents
    // a key we can verify instead of an unknown type that looks like a change.
    const knownTypes = this.config.hostKey
      ? []
      : [
          ...new Set(
            findKnownKeys(this.config.host, port)
              .flatMap((entry) => algorithmsForKeyType(entry.keyType))
              .filter((alg) => SUPPORTED_HOST_KEY_ALGORITHMS.has(alg)),
          ),
        ];
    if (knownTypes.length > 0) {
      connectConfig.algorithms = {
        serverHostKey: { prepend: knownTypes } as NonNullable<
          ConnectConfig['algorithms']
        >['serverHostKey'],
      };
    }

    return new Promise((resolve, reject) => {
      this.client
        .on('ready', () => {
          this.connected = true;
          if (keyToRemember) {
            const file = rememberHostKey(this.config.host, port, keyToRemember);
            Logger.info(`Saved host key to ${file}`);
          }
          Logger.info(`Connected to ${this.config.host}`);
          resolve();
        })
        .on('error', (err: Error) => {
          const message = hostKeyError ?? err.message;
          Logger.error(`SSH connection failed: ${message}`);
          reject(new Error(message));
        })
        .connect(connectConfig);
    });
  }

  private readPrivateKey(): Buffer {
    const keyPath = this.config.privateKeyPath.replace(/^~(?=$|[/\\])/, os.homedir());
    try {
      return fs.readFileSync(keyPath);
    } catch {
      throw new Error(`Cannot read SSH private key: ${keyPath}`);
    }
  }

  async exec(command: string): Promise<CommandResult> {
    if (!this.connected) {
      throw new Error('SSH client not connected. Call connect() first.');
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      this.client.exec(command, (err: Error | undefined, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }

        const s = stream as NodeJS.ReadableStream & {
          stderr: NodeJS.ReadableStream;
          on(event: 'close', listener: (code: number) => void): typeof s;
          on(event: 'data', listener: (data: Buffer) => void): typeof s;
        };

        s.on('close', (code: number) => {
          resolve({
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            success: code === 0,
          });
        }).on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        s.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * Write a file on the server over SFTP with the given permissions.
   * Use this for anything secret: unlike a shell command, the contents never
   * appear in the remote process list or shell history.
   * Relative paths are resolved against the remote user's home directory.
   */
  async writeFile(remotePath: string, content: string, mode: number = 0o600): Promise<void> {
    if (!this.connected) {
      throw new Error('SSH client not connected. Call connect() first.');
    }

    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP unavailable: ${err.message}`));
          return;
        }

        sftp.writeFile(remotePath, content, { mode }, (writeErr) => {
          if (writeErr) {
            sftp.end();
            reject(new Error(`Failed to write ${remotePath}: ${writeErr.message}`));
            return;
          }
          // mode only applies on creation; enforce it for pre-existing files too.
          sftp.chmod(remotePath, mode, (chmodErr) => {
            sftp.end();
            if (chmodErr) {
              reject(new Error(`Failed to chmod ${remotePath}: ${chmodErr.message}`));
            } else {
              resolve();
            }
          });
        });
      });
    });
  }

  /**
   * Forward a local port on 127.0.0.1 to remoteHost:remotePort as seen from the
   * server, through this SSH connection. Lets the CLI talk to services (like
   * Redis) that are only bound to the server's loopback interface.
   */
  async openTunnel(remotePort: number, remoteHost: string = '127.0.0.1'): Promise<Tunnel> {
    if (!this.connected) {
      throw new Error('SSH client not connected. Call connect() first.');
    }

    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      // Attach before anything can fail: an unhandled socket 'error' crashes the process.
      socket.on('error', () => {});

      this.client.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (err, stream) => {
        if (err) {
          // e.g. nothing listening on the remote port: the server refuses the channel.
          // Closing the local socket lets the client (ioredis) report a normal error.
          socket.destroy();
          return;
        }
        stream.on('error', () => socket.destroy());
        socket.on('error', () => stream.destroy());
        socket.pipe(stream).pipe(socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as net.AddressInfo;
    return {
      localPort: address.port,
      close: () => {
        for (const socket of sockets) socket.destroy();
        server.close();
      },
    };
  }

  async execMany(commands: string[]): Promise<CommandResult[]> {
    const results: CommandResult[] = [];

    for (const command of commands) {
      Logger.info(`Executing: ${command}`);
      const result = await this.exec(command);
      results.push(result);

      if (!result.success) {
        Logger.warn(`Command failed: ${command}`);
      }
    }

    return results;
  }

  disconnect(): void {
    if (this.connected) {
      this.client.end();
      this.connected = false;
      Logger.info(`Disconnected from ${this.config.host}`);
    }
  }
}
