import { SSHClient } from '../ssh/sshClient';
import { Logger } from '../utils/logger';

export interface InfrastructureStatus {
  traefikRunning: boolean;
  redisRunning: boolean;
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
        `docker ps -q --filter "name=${this.traefikContainerName}" --filter "status=running"`,
      ),
      this.ssh.exec(
        `docker ps -q --filter "name=${this.redisContainerName}" --filter "status=running"`,
      ),
      this.ssh.exec(`docker network inspect ${this.networkName}`),
    ]);

    return {
      traefikRunning: traefikResult.success && traefikResult.stdout.trim().length > 0,
      redisRunning: redisResult.success && redisResult.stdout.trim().length > 0,
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

    // Start Redis if needed
    if (!status.redisRunning) {
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

    const result = await this.ssh.exec(`docker network create ${this.networkName}`);

    if (!result.success) {
      throw new Error(`Failed to create network: ${result.stderr}`);
    }

    Logger.success(`Created network: ${this.networkName}`);
  }

  /**
   * Start Redis container with persistent volume
   */
  private async startRedis(): Promise<void> {
    Logger.info('Starting Redis container...');

    // Create volume if it doesn't exist
    await this.ssh.exec(`docker volume create ${this.redisVolumeName}`);

    // Remove any existing stopped container
    await this.ssh.exec(`docker rm -f ${this.redisContainerName} 2>/dev/null || true`);

    // Run Redis with volume mount
    const command = [
      'docker run -d',
      `--name ${this.redisContainerName}`,
      `--network ${this.networkName}`,
      '--restart unless-stopped',
      `-v ${this.redisVolumeName}:/data`,
      '-p 6379:6379',
      'redis:7-alpine',
      'redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru',
    ].join(' ');

    const result = await this.ssh.exec(command);

    if (!result.success) {
      throw new Error(`Failed to start Redis: ${result.stderr}`);
    }

    Logger.success('Redis container started');
  }

  /**
   * Start Traefik reverse proxy
   */
  private async startTraefik(): Promise<void> {
    Logger.info('Starting Traefik container...');

    await this.ssh.exec(`docker rm -f ${this.traefikContainerName} 2>/dev/null || true`);

    const result = await this.ssh.exec(
      [
        'docker run -d',
        `--name ${this.traefikContainerName}`,
        `--network ${this.networkName}`,
        '--restart unless-stopped',
        '-p 80:80',
        '-p 443:443',
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

  getRedisHost(): string {
    // Redis runs in a container on the same network
    // Apps can connect via container name or localhost (port exposed)
    return 'localhost';
  }

  async stopInfrastructure(): Promise<void> {
    Logger.info('Stopping infrastructure containers...');

    await this.ssh.exec(
      `docker stop ${this.traefikContainerName} ${this.redisContainerName} 2>/dev/null || true`,
    );
    await this.ssh.exec(
      `docker rm ${this.traefikContainerName} ${this.redisContainerName} 2>/dev/null || true`,
    );

    Logger.success('Infrastructure stopped');
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
