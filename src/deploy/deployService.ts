import { loadConfig, sshConfigFrom } from '../config/configLoader';
import { DockerManager } from '../docker/dockerManager';
import { Traefik } from '../routing/traefik';
import { SSHClient } from '../ssh/sshClient';
import { RedisStorage } from '../storage/redis';
import { InfrastructureSetup } from '../setup/infrastructureSetup';
import { OrcaConfig, DeploymentMetadata } from '../types/config';
import { Logger } from '../utils/logger';
import { shellEscape } from '../utils/shell';

export class DeployService {
  private config: OrcaConfig;
  private ssh: SSHClient | null = null;
  private docker: DockerManager | null = null;
  private redis: RedisStorage | null = null;
  private traefik: Traefik;
  private infraSetup: InfrastructureSetup | null = null;

  constructor(config: OrcaConfig) {
    this.config = config;
    this.traefik = new Traefik();
  }

  async deploy(): Promise<DeploymentMetadata> {
    Logger.newline();
    Logger.info(`Starting deployment for: ${this.config.app.name}`);
    Logger.newline();
    let newContainerId: string | null = null;

    try {
      // Step 1: Connect to infrastructure
      await this.connect();

      // Step 2: Get current deployment for zero-downtime swap
      const previousDeployment = await this.redis!.getLastSuccessfulDeployment(
        this.config.app.name,
      );

      // Step 3: Prepare source code on VPS
      await this.prepareSourceCode();

      // Step 4: Build Docker image
      const imageTag = await this.buildImage();

      // Step 5: Create and start new container
      const containerId = await this.createContainer(imageTag);
      newContainerId = containerId;

      // Step 6: Perform health check
      await this.healthCheck(containerId);

      // Step 7: Save deployment state
      const deployment = await this.saveDeploymentState(containerId);

      // Step 8: Stop previous container (zero-downtime cleanup)
      if (previousDeployment) {
        await this.cleanupPreviousDeployment(previousDeployment.containerId);
      }

      Logger.newline();
      Logger.success(`Deployment completed successfully!`);
      Logger.success(`Container: ${containerId.substring(0, 12)}`);
      Logger.success(`URL: https://${this.config.app.domain}`);

      return deployment;
    } catch (error) {
      if (newContainerId && this.docker) {
        Logger.warn('Cleaning up failed deployment container...');
        try {
          await this.docker.stopContainer(newContainerId);
        } catch (cleanupError) {
          Logger.warn(
            `Failed to clean up container ${newContainerId.substring(0, 12)}: ${
              cleanupError instanceof Error ? cleanupError.message : 'Unknown error'
            }`,
          );
        }
      }
      Logger.error(
        `Deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    } finally {
      // Always disconnect
      this.disconnect();
    }
  }

  private async connect(): Promise<void> {
    Logger.step(1, 'Connecting to infrastructure...');

    // Connect to SSH
    this.ssh = new SSHClient(sshConfigFrom(this.config));
    await this.ssh.connect();

    // Initialize Docker manager
    this.docker = new DockerManager(this.ssh, this.config.app.name);

    // Setup infrastructure (Traefik + Redis) on fresh VPS
    this.infraSetup = new InfrastructureSetup(this.ssh);
    await this.infraSetup.ensureInfrastructure();

    // Connect to Redis on the VPS (loopback only) through the SSH connection
    this.redis = new RedisStorage(this.ssh);
    await this.redis.connect();

    Logger.success('Connected to all infrastructure');
  }

  private async buildImage(): Promise<string> {
    // For now, we assume the code is already on the server
    // In a full implementation, this would pull the git repo first
    const projectPath = `/opt/orca/apps/${this.config.app.name}`;
    const imageTag = `${this.config.app.name}:latest`;

    return this.docker!.buildImage(projectPath, imageTag);
  }

  private async prepareSourceCode(): Promise<void> {
    Logger.step(3, 'Preparing source code on VPS...');

    const projectRoot = '/opt/orca/apps';
    const projectPath = `${projectRoot}/${this.config.app.name}`;
    const repo = this.config.git.repository;
    const branch = this.config.git.branch;
    const escapedProjectRoot = shellEscape(projectRoot);
    const escapedProjectPath = shellEscape(projectPath);
    const escapedBranch = shellEscape(branch);
    const escapedRepo = shellEscape(repo);

    const syncScript = [
      'set -e',
      `mkdir -p ${escapedProjectRoot}`,
      `if [ -d ${escapedProjectPath}/.git ]; then`,
      `  cd ${escapedProjectPath}`,
      '  git fetch --all --prune',
      `  git checkout ${escapedBranch} --`,
      `  git pull --ff-only origin ${escapedBranch}`,
      'else',
      `  git clone --depth 1 --branch ${escapedBranch} -- ${escapedRepo} ${escapedProjectPath}`,
      'fi',
    ].join('\n');

    const result = await this.ssh!.exec(`bash -lc ${shellEscape(syncScript)}`);
    if (!result.success) {
      throw new Error(`Failed to prepare source on VPS: ${result.stderr || result.stdout}`);
    }

    Logger.success('Source code is ready');
  }

  private async createContainer(imageTag: string): Promise<string> {
    // Generate Traefik labels
    const traefikLabels = this.traefik.generateLabels({
      domain: this.config.app.domain,
      port: this.config.app.port,
      tls: true,
      appName: this.config.app.name,
    });

    // Generate environment variables
    const envVars = this.traefik.generateEnvVars({
      domain: this.config.app.domain,
      port: this.config.app.port,
      tls: true,
      appName: this.config.app.name,
    });

    // Create container config
    const containerConfig = {
      name: `${this.config.app.name}-${Date.now()}`,
      image: imageTag,
      // Traffic is routed through Traefik on the shared network.
      ports: [],
      env: { ...envVars, ...this.config.app.envs },
      network: this.config.app.network || this.traefik.getNetworkName(),
      restart: this.config.app.restart,
      labels: traefikLabels,
    };

    return this.docker!.createContainer(containerConfig);
  }

  private async healthCheck(containerId: string): Promise<void> {
    Logger.step(6, 'Performing health check...');

    // Wait a few seconds for the container to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check if container is running
    const isHealthy = await this.docker!.isHealthy(containerId);

    if (!isHealthy) {
      throw new Error(
        `Health check failed: Container ${containerId.substring(0, 12)} is not running`,
      );
    }

    // In a full implementation, this would also:
    // - Check HTTP endpoint
    // - Verify application logs
    // - Run custom health check commands

    Logger.success('Health check passed');
  }

  private async saveDeploymentState(containerId: string): Promise<DeploymentMetadata> {
    Logger.step(7, 'Saving deployment state...');

    const deployment: DeploymentMetadata = {
      id: Date.now().toString(),
      appName: this.config.app.name,
      containerId,
      startedAt: new Date().toISOString(),
      status: 'running',
      // In a full implementation, this would include the git commit hash
    };

    await this.redis!.saveDeployment(deployment);

    Logger.success('Deployment state saved');

    return deployment;
  }

  private async cleanupPreviousDeployment(containerId: string): Promise<void> {
    Logger.step(8, 'Stopping previous deployment...');

    await this.docker!.stopContainer(containerId);

    Logger.success('Previous deployment stopped');
  }

  private disconnect(): void {
    // Redis first: it runs over the SSH tunnel
    if (this.redis) {
      this.redis.disconnect();
    }
    if (this.ssh) {
      this.ssh.disconnect();
    }
  }
}

export async function createDeployService(configPath?: string): Promise<DeployService> {
  const config = await loadConfig(configPath);
  return new DeployService(config);
}
