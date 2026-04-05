import Redis from 'ioredis';
import { DeploymentMetadata } from '../types/config';
import { Logger } from '../utils/logger';

export class RedisStorage {
  private client: Redis | null = null;
  private host: string;
  private port: number;

  constructor(host: string = 'localhost', port: number = 6379) {
    this.host = host;
    this.port = port;
  }

  async connect(): Promise<void> {
    this.client = new Redis({
      host: this.host,
      port: this.port,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    this.client.on('error', (err: Error) => {
      Logger.error(`Redis error: ${err.message}`);
    });

    this.client.on('connect', () => {
      Logger.info(`Connected to Redis at ${this.host}:${this.port}`);
    });

    // Wait for connection
    await this.client.ping();
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
      Logger.info('Disconnected from Redis');
    }
  }

  private getDeploymentKey(appName: string, deploymentId: string): string {
    return `orca:deployments:${appName}:${deploymentId}`;
  }

  private getHistoryKey(appName: string): string {
    return `orca:history:${appName}`;
  }
}
