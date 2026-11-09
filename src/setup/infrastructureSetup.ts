import crypto from 'node:crypto';
import { SSHClient } from '../ssh/sshClient';
import { Logger } from '../utils/logger';
import { shellEscape } from '../utils/shell';

/** Port Redis listens on, bound to the VPS loopback interface only. */
export const REDIS_PORT = 6379;
/** Redis password file on the VPS, relative to the deploy user's home (mode 600). */
export const REDIS_PASSWORD_FILE = '.orca/redis.pass';
/** Redis config file on the VPS, relative to the deploy user's home. */
const REDIS_CONFIG_FILE = '.orca/redis.conf';
/**
 * Bumped whenever the Redis container's security settings change, so older
 * containers are detected and re-created on the next deploy.
 */
const REDIS_SECURITY_VERSION = '1';

export interface InfrastructureStatus {
  traefikRunning: boolean;
  redisRunning: boolean;
  /** Redis is running with the current security settings (loopback-only, password) */
  redisSecure: boolean;
  networkExists: boolean;
}

export class InfrastructureSetup {
  private ssh: SSHClient;
  private networkName: string = 'traefik';
  private traefikContainerName: string = 'traefik';
  private redisContainerName: string = 'orca-redis';
  private redisVolumeName: string = 'orca-redis-data';

  constructor(ssh: SSHClient) {
    this.ssh = ssh;
  }

  async checkStatus(): Promise<InfrastructureStatus> {
    const [traefikResult, redisResult, networkResult] = await Promise.all([
      this.ssh.exec(
        `docker inspect --format '{{.State.Running}}' ${shellEscape(this.traefikContainerName)}`,
      ),
      this.ssh.exec(
        `docker inspect --format '{{.State.Running}} {{index .Config.Labels "orca.redis.secure"}}' ${shellEscape(this.redisContainerName)}`,
      ),
      this.ssh.exec(`docker network inspect ${shellEscape(this.networkName)}`),
    ]);

    const [redisRunningFlag, redisSecurityVersion] = redisResult.stdout.trim().split(/\s+/);
    const redisRunning = redisResult.success && redisRunningFlag === 'true';

    return {
      traefikRunning: traefikResult.success && traefikResult.stdout.trim() === 'true',
      redisRunning,
      redisSecure: redisRunning && redisSecurityVersion === REDIS_SECURITY_VERSION,
      networkExists: networkResult.success,
    };
  }

  async ensureInfrastructure(): Promise<void> {
    Logger.info('Checking VPS infrastructure...');
    await this.ensureSystemRequirements();

    const status = await this.checkStatus();

    // Create network if needed
    if (!status.networkExists) {
      await this.createNetwork();
    }

    // Start Redis if needed, or re-create it if it predates the security settings
    if (!status.redisRunning) {
      await this.startRedis();
    } else if (!status.redisSecure) {
      Logger.warn(
        'Redis is running with insecure settings (public port, no password). ' +
          'Re-creating it bound to localhost with a password; stored data is kept.',
      );
      await this.startRedis();
    }

    // Start Traefik if needed
    if (!status.traefikRunning) {
      await this.startTraefik();
    }

    Logger.success('Infrastructure is ready');
  }

  private async ensureSystemRequirements(): Promise<void> {
    const dockerCheck = await this.ssh.exec('command -v docker');
    if (!dockerCheck.success) {
      Logger.warn('Docker not found. Attempting automatic installation...');
      await this.installDocker();
    }

    const gitCheck = await this.ssh.exec('command -v git');
    if (!gitCheck.success) {
      throw new Error(
        'Git is not installed on the VPS. Install git first (for example: sudo apt-get install -y git).',
      );
    }
  }

  private async installDocker(): Promise<void> {
    const installScript = [
      'set -e',
      'if command -v apt-get >/dev/null 2>&1; then',
      '  sudo apt-get update -y',
      '  sudo apt-get install -y ca-certificates curl',
      '  curl -fsSL https://get.docker.com | sudo sh',
      'elif command -v dnf >/dev/null 2>&1; then',
      '  curl -fsSL https://get.docker.com | sudo sh',
      'elif command -v yum >/dev/null 2>&1; then',
      '  curl -fsSL https://get.docker.com | sudo sh',
      'else',
      '  exit 12',
      'fi',
    ].join('\n');

    const result = await this.ssh.exec(`bash -lc ${shellEscape(installScript)}`);
    if (!result.success) {
      throw new Error(
        `Docker installation failed. Ensure sudo is available for ${result.stderr || 'the deploy user'}.`,
      );
    }

    Logger.success('Docker installed');
  }

  private async createNetwork(): Promise<void> {
    Logger.info(`Creating Docker network: ${this.networkName}`);

    const result = await this.ssh.exec(`docker network create ${shellEscape(this.networkName)}`);

    if (!result.success) {
      throw new Error(`Failed to create network: ${result.stderr}`);
    }

    Logger.success(`Created network: ${this.networkName}`);
  }

  /**
   * Make sure the Redis password exists on the VPS and return it.
   * Generated locally and written over SFTP so it never appears on a command line.
   */
  async ensureRedisPassword(): Promise<string> {
    await this.ensureOrcaDir();

    const existing = await this.ssh.exec(`cat "$HOME/${REDIS_PASSWORD_FILE}" 2>/dev/null`);
    const current = existing.success ? existing.stdout.trim() : '';
    if (current) {
      return current;
    }

    const password = crypto.randomBytes(32).toString('hex');
    await this.ssh.writeFile(REDIS_PASSWORD_FILE, `${password}\n`, 0o600);
    Logger.info(`Generated Redis password (stored in ~/${REDIS_PASSWORD_FILE} on the VPS)`);
    return password;
  }

  private async ensureOrcaDir(): Promise<void> {
    const result = await this.ssh.exec('mkdir -p "$HOME/.orca" && chmod 700 "$HOME/.orca"');
    if (!result.success) {
      throw new Error(`Failed to create ~/.orca on the VPS: ${result.stderr}`);
    }
  }

  /**
   * Start Redis container with persistent volume.
   *
   * Security:
   * - published on 127.0.0.1 only; the CLI reaches it through an SSH tunnel
   * - not attached to the app network, so app containers cannot reach it
   * - password-protected via a config file (not a command-line flag, which
   *   would be visible in `ps` to every user on the VPS)
   */
  private async startRedis(): Promise<void> {
    Logger.info('Starting Redis container...');

    const password = await this.ensureRedisPassword();

    // ~/.orca is mode 700, which keeps other VPS users out. The file itself must
    // be readable by the redis user inside the container, hence 644.
    await this.ssh.writeFile(
      REDIS_CONFIG_FILE,
      [
        `requirepass ${password}`,
        'appendonly yes',
        'maxmemory 256mb',
        'maxmemory-policy allkeys-lru',
        '',
      ].join('\n'),
      0o644,
    );

    // Create volume if it doesn't exist
    await this.ssh.exec(`docker volume create ${shellEscape(this.redisVolumeName)}`);

    // Remove any existing container (data lives in the volume)
    await this.ssh.exec(`docker rm -f ${shellEscape(this.redisContainerName)} 2>/dev/null || true`);

    const command = [
      'docker run -d',
      `--name ${shellEscape(this.redisContainerName)}`,
      '--restart unless-stopped',
      `--label orca.redis.secure=${REDIS_SECURITY_VERSION}`,
      `-v ${shellEscape(this.redisVolumeName)}:/data`,
      `-v "$HOME/${REDIS_CONFIG_FILE}":/usr/local/etc/redis/redis.conf:ro`,
      `-p 127.0.0.1:${REDIS_PORT}:6379`,
      'redis:7-alpine',
      'redis-server /usr/local/etc/redis/redis.conf',
    ].join(' ');

    const result = await this.ssh.exec(command);

    if (!result.success) {
      throw new Error(`Failed to start Redis: ${result.stderr}`);
    }

    Logger.success('Redis container started (localhost only, password protected)');
  }

  /**
   * Start Traefik reverse proxy
   */
  private async startTraefik(): Promise<void> {
    Logger.info('Starting Traefik container...');

    await this.ssh.exec(
      `docker rm -f ${shellEscape(this.traefikContainerName)} 2>/dev/null || true`,
    );

    const result = await this.ssh.exec(
      [
        'docker run -d',
        `--name ${shellEscape(this.traefikContainerName)}`,
        `--network ${shellEscape(this.networkName)}`,
        '--restart unless-stopped',
        '-p 80:80',
        '-p 443:443',
        // Note: even read-only, the Docker socket gives Traefik root-equivalent
        // access to the host. Traefik is kept off the public dashboard for that reason.
        '-v /var/run/docker.sock:/var/run/docker.sock:ro',
        '-v traefik-certs:/letsencrypt',
        'traefik:v3.0',
        '--api.dashboard=false',
        '--providers.docker=true',
        '--providers.docker.network=traefik',
        '--providers.docker.exposedByDefault=false',
        '--entrypoints.web.address=:80',
        '--entrypoints.websecure.address=:443',
        '--certificatesresolvers.letsencrypt.acme.tlschallenge=true',
        '--certificatesresolvers.letsencrypt.acme.email=admin@localhost',
        '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json',
      ].join(' '),
    );

    if (!result.success) {
      throw new Error(`Failed to start Traefik: ${result.stderr}`);
    }

    Logger.success('Traefik container started');
  }

  async stopInfrastructure(): Promise<void> {
    Logger.info('Stopping infrastructure containers...');

    const names = `${shellEscape(this.traefikContainerName)} ${shellEscape(this.redisContainerName)}`;
    await this.ssh.exec(`docker stop ${names} 2>/dev/null || true`);
    await this.ssh.exec(`docker rm ${names} 2>/dev/null || true`);

    Logger.success('Infrastructure stopped');
  }
}
