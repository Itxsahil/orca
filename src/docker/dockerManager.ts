import { SSHClient } from '../ssh/sshClient';
import { ContainerConfig } from '../types/config';
import { Logger } from '../utils/logger';

export class DockerManager {
  private ssh: SSHClient;
  private appName: string;

  constructor(ssh: SSHClient, appName: string) {
    this.ssh = ssh;
    this.appName = appName;
  }

  async buildImage(projectPath: string, tag?: string): Promise<string> {
    const imageTag = tag || `${this.appName}:latest`;
    const command = `cd ${projectPath} && docker build -t ${imageTag} .`;

    Logger.step(4, 'Building Docker image...');

    const result = await this.ssh.exec(command);

    if (!result.success) {
      throw new Error(`Docker build failed: ${result.stderr}`);
    }

    Logger.success(`Built image: ${imageTag}`);
    return imageTag;
  }

  async createContainer(config: ContainerConfig): Promise<string> {
    const timestamp = Date.now();
    const containerName = config.name || `${this.appName}-${timestamp}`;

    // Build docker run command
    let command = `docker run -d --name ${containerName}`;

    if (config.restart) {
      command += ` --restart ${config.restart}`;
    }

    // Add port mappings
    for (const port of config.ports) {
      command += ` -p ${port}`;
    }

    // Add environment variables
    for (const [key, value] of Object.entries(config.env)) {
      command += ` -e ${key}=${shellEscape(value)}`;
    }

    // Add network if specified
    if (config.network) {
      command += ` --network ${config.network}`;
    }

    // Add volume mounts
    if (config.volumes) {
      for (const volume of config.volumes) {
        command += ` -v ${volume}`;
      }
    }

    // Add Traefik labels for routing
    if (config.labels) {
      for (const [key, value] of Object.entries(config.labels)) {
        command += ` --label ${shellEscape(`${key}=${value}`)}`;
      }
    }

    command += ` ${config.image}`;

    Logger.step(5, `Starting container: ${containerName}`);

    const result = await this.ssh.exec(command);

    if (!result.success) {
      throw new Error(`Failed to create container: ${result.stderr}`);
    }

    const containerId = result.stdout.trim();
    Logger.success(`Container started: ${containerId.substring(0, 12)}`);

    return containerId;
  }

  async stopContainer(containerId: string): Promise<void> {
    Logger.info(`Stopping container: ${containerId.substring(0, 12)}`);

    // Stop the container gracefully
    const stopResult = await this.ssh.exec(`docker stop ${containerId}`);
    if (!stopResult.success) {
      Logger.warn(`Failed to stop container: ${stopResult.stderr}`);
    }

    // Remove the container
    const rmResult = await this.ssh.exec(`docker rm ${containerId}`);
    if (!rmResult.success) {
      Logger.warn(`Failed to remove container: ${rmResult.stderr}`);
    }

    Logger.success(`Stopped and removed container: ${containerId.substring(0, 12)}`);
  }

  async startContainer(containerId: string): Promise<void> {
    Logger.info(`Starting container: ${containerId.substring(0, 12)}`);

    const result = await this.ssh.exec(`docker start ${containerId}`);
    if (!result.success) {
      throw new Error(`Failed to start container ${containerId}: ${result.stderr}`);
    }

    Logger.success(`Started container: ${containerId.substring(0, 12)}`);
  }

  async getLogs(containerId: string, tail: number = 100): Promise<string> {
    const command = `docker logs --tail ${tail} ${containerId}`;
    const result = await this.ssh.exec(command);

    if (!result.success) {
      throw new Error(`Failed to get logs: ${result.stderr}`);
    }

    return result.stdout;
  }

  async isHealthy(containerId: string): Promise<boolean> {
    const command = `docker inspect --format='{{.State.Status}}' ${containerId}`;
    const result = await this.ssh.exec(command);

    if (!result.success) {
      return false;
    }

    const status = result.stdout.trim();
    return status === 'running';
  }

  async listAppContainers(): Promise<Array<{ id: string; name: string }>> {
    const command = `docker ps -a --filter "name=${this.appName}" --format "{{.ID}}|{{.Names}}"`;
    const result = await this.ssh.exec(command);

    if (!result.success) {
      return [];
    }

    return result.stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [id, name] = line.split('|');
        return { id: id.trim(), name: name.trim() };
      });
  }

  async ensureNetwork(networkName: string = 'traefik'): Promise<void> {
    const checkCommand = `docker network inspect ${networkName}`;
    const checkResult = await this.ssh.exec(checkCommand);

    if (!checkResult.success) {
      Logger.info(`Creating Docker network: ${networkName}`);
      const createCommand = `docker network create ${networkName}`;
      const createResult = await this.ssh.exec(createCommand);

      if (!createResult.success) {
        throw new Error(`Failed to create network: ${createResult.stderr}`);
      }

      Logger.success(`Created network: ${networkName}`);
    }
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
