import Redis from 'ioredis';
import { DeploymentMetadata } from '../types/config';
import { SSHClient, Tunnel } from '../ssh/sshClient';
import { REDIS_PASSWORD_FILE, REDIS_PORT } from '../setup/infrastructureSetup';
import { Logger } from '../utils/logger';

/**
 * Deployment state store.
 *
 * Redis on the VPS only listens on 127.0.0.1, so the CLI reaches it through an
 * SSH tunnel over the already-authenticated SSH connection, and authenticates
 * with the password stored on the VPS. Nothing is exposed to the internet.
 */
export class RedisStorage {
  private client: Redis | null = null;
  private tunnel: Tunnel | null = null;
  private ssh: SSHClient;
  private remotePort: number;

  constructor(ssh: SSHClient, remotePort: number = REDIS_PORT) {
    this.ssh = ssh;
    this.remotePort = remotePort;
  }

  async connect(): Promise<void> {
    const password = await this.readPassword();
    this.tunnel = await this.ssh.openTunnel(this.remotePort);

    this.client = new Redis({
      host: '127.0.0.1',
      port: this.tunnel.localPort,
      password,
      connectTimeout: 10000,
      maxRetriesPerRequest: 2,
      // Give up after a few attempts instead of hanging the CLI forever.
      retryStrategy: (times) => (times > 3 ? null : times * 200),
    });

    this.client.on('error', (err: Error) => {
      Logger.error(`Redis error: ${err.message}`);
    });

    try {
      await this.client.ping();
    } catch (error) {
      this.disconnect();
      throw new Error(
        `Could not reach Redis on the VPS through SSH (${
          error instanceof Error ? error.message : 'unknown error'
        }). Run "orca deploy" once to set up the server.`,
      );
    }

    Logger.info('Connected to Redis (via SSH tunnel)');
  }

  /** Read the Redis password from the VPS. Missing on servers set up by older Orca versions. */
  private async readPassword(): Promise<string | undefined> {
    const result = await this.ssh.exec(`cat "$HOME/${REDIS_PASSWORD_FILE}" 2>/dev/null`);
    const password = result.success ? result.stdout.trim() : '';
    return password || undefined;
  }

  async saveDeployment(deployment: DeploymentMetadata): Promise<void> {
    if (!this.client) {
      throw new Error('Redis not connected. Call connect() first.');
    }

    const key = this.getDeploymentKey(deployment.appName, deployment.id);

    // Store deployment as hash
    await this.client.hmset(key, {
      id: deployment.id,
      appName: deployment.appName,
      containerId: deployment.containerId,
      startedAt: deployment.startedAt,
      status: deployment.status,
      commitHash: deployment.commitHash || '',
    });

    // Add to sorted set for history (score is timestamp)
    const historyKey = this.getHistoryKey(deployment.appName);
    await this.client.zadd(historyKey, Date.now(), deployment.id);

    Logger.info(`Saved deployment ${deployment.id} for ${deployment.appName}`);
  }

  async getDeployment(appName: string, deploymentId: string): Promise<DeploymentMetadata | null> {
    if (!this.client) {
      throw new Error('Redis not connected. Call connect() first.');
    }

    const key = this.getDeploymentKey(appName, deploymentId);
    const data = await this.client.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      id: data.id,
      appName: data.appName,
      containerId: data.containerId,
      startedAt: data.startedAt,
      status: data.status as DeploymentMetadata['status'],
      commitHash: data.commitHash || undefined,
    };
  }

  async getDeploymentHistory(appName: string, limit: number = 10): Promise<DeploymentMetadata[]> {
    if (!this.client) {
      throw new Error('Redis not connected. Call connect() first.');
    }

    const historyKey = this.getHistoryKey(appName);

    // Get deployment IDs from sorted set (most recent first)
    const ids = await this.client.zrevrange(historyKey, 0, limit - 1);

    // Fetch each deployment
    const deployments: DeploymentMetadata[] = [];
    for (const id of ids) {
      const deployment = await this.getDeployment(appName, id);
      if (deployment) {
        deployments.push(deployment);
      }
    }

    return deployments;
  }

  async updateDeploymentStatus(
    appName: string,
    deploymentId: string,
    status: DeploymentMetadata['status'],
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Redis not connected. Call connect() first.');
    }

    const key = this.getDeploymentKey(appName, deploymentId);
    await this.client.hset(key, 'status', status);

    Logger.info(`Updated deployment ${deploymentId} status to ${status}`);
  }

  async getLastSuccessfulDeployment(appName: string): Promise<DeploymentMetadata | null> {
    const history = await this.getDeploymentHistory(appName, 20);
    return history.find((d) => d.status === 'running') || null;
  }

  disconnect(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
      Logger.info('Disconnected from Redis');
    }
    if (this.tunnel) {
      this.tunnel.close();
      this.tunnel = null;
    }
  }

  private getDeploymentKey(appName: string, deploymentId: string): string {
    return `orca:deployments:${appName}:${deploymentId}`;
  }

  private getHistoryKey(appName: string): string {
    return `orca:history:${appName}`;
  }
}
