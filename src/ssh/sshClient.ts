import { Client } from 'ssh2';
import * as fs from 'fs';
import { SSHConnectionConfig, CommandResult } from '../types/config';
import { Logger } from '../utils/logger';

export class SSHClient {
  private client: Client;
  private config: SSHConnectionConfig;
  private connected: boolean = false;

  constructor(config: SSHConnectionConfig) {
    this.config = config;
    this.client = new Client();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Read private key from file
      const privateKey = fs.readFileSync(
        this.config.privateKeyPath.replace('~', process.env.HOME || ''),
      );

      this.client
        .on('ready', () => {
          this.connected = true;
          Logger.info(`Connected to ${this.config.host}`);
          resolve();
        })
        .on('error', (err: Error) => {
          Logger.error(`SSH connection failed: ${err.message}`);
          reject(err);
        })
        .connect({
          host: this.config.host,
          port: this.config.port || 22,
          username: this.config.username,
          privateKey,
        });
    });
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
