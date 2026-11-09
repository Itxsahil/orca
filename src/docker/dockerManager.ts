import { SSHClient } from '../ssh/sshClient';
import { ContainerConfig } from '../types/config';
import { Logger } from '../utils/logger';
import { shellEscape } from '../utils/shell';

/** Private scratch directory on the VPS, relative to the deploy user's home. */
const REMOTE_TMP_DIR = '.orca/tmp';

export class DockerManager {
  private ssh: SSHClient;
  private appName: string;

  constructor(ssh: SSHClient, appName: string) {
    this.ssh = ssh;
    this.appName = appName;
  }

  async buildImage(projectPath: string, tag?: string): Promise<string> {
    const imageTag = tag || `${this.appName}:latest`;
    const command = `cd ${shellEscape(projectPath)} && docker build -t ${shellEscape(imageTag)} .`;

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
    const args: string[] = ['docker run -d', `--name ${shellEscape(containerName)}`];

    if (config.restart) {
      args.push(`--restart ${shellEscape(config.restart)}`);
    }

    // Add port mappings
    for (const port of config.ports) {
      args.push(`-p ${shellEscape(port)}`);
    }

    // Environment variables go through a private env file instead of `-e KEY=value`,
    // so secret values never show up in the VPS process list or shell history.
    const envFilePath = await this.writeEnvFile(containerName, config.env);
    if (envFilePath) {
      args.push(`--env-file "$HOME/"${shellEscape(envFilePath)}`);
    }

    // Add network if specified
    if (config.network) {
      args.push(`--network ${shellEscape(config.network)}`);
    }

    // Add volume mounts
    if (config.volumes) {
      for (const volume of config.volumes) {
        args.push(`-v ${shellEscape(volume)}`);
      }
    }

    // Add Traefik labels for routing
    if (config.labels) {
      for (const [key, value] of Object.entries(config.labels)) {
        args.push(`--label ${shellEscape(`${key}=${value}`)}`);
      }
    }

    args.push(shellEscape(config.image));

    Logger.step(5, `Starting container: ${containerName}`);

    let result;
    try {
      result = await this.ssh.exec(args.join(' '));
    } finally {
      if (envFilePath) {
        // Docker has copied the values into the container config; drop the file.
        await this.ssh.exec(`rm -f "$HOME/"${shellEscape(envFilePath)}`);
      }
    }

    if (!result.success) {
      throw new Error(`Failed to create container: ${result.stderr}`);
    }

    const containerId = result.stdout.trim();
    Logger.success(`Container started: ${containerId.substring(0, 12)}`);

    return containerId;
  }

  /**
   * Write env vars to a mode-600 file in ~/.orca/tmp on the VPS (over SFTP).
   * Returns the path relative to the remote home directory, or null if there are none.
   */
  private async writeEnvFile(
    containerName: string,
    env: Record<string, string>,
  ): Promise<string | null> {
    const entries = Object.entries(env);
    if (entries.length === 0) return null;

    for (const [key, value] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment variable name: ${key}`);
      }
      if (/[\r\n\0]/.test(value)) {
        throw new Error(`Environment variable ${key} contains a line break`);
      }
    }

    const mkdir = await this.ssh.exec(
      `mkdir -p "$HOME/${REMOTE_TMP_DIR}" && chmod 700 "$HOME/.orca" "$HOME/${REMOTE_TMP_DIR}"`,
    );
    if (!mkdir.success) {
      throw new Error(`Failed to create ~/${REMOTE_TMP_DIR} on the VPS: ${mkdir.stderr}`);
    }

    // Docker env files are KEY=VALUE per line, taken literally (no quoting).
    const content = entries.map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    const remotePath = `${REMOTE_TMP_DIR}/${containerName}.env`;
    await this.ssh.writeFile(remotePath, content, 0o600);
    return remotePath;
  }

  async stopContainer(containerId: string): Promise<void> {
    Logger.info(`Stopping container: ${containerId.substring(0, 12)}`);

    // Stop the container gracefully
    const stopResult = await this.ssh.exec(`docker stop ${shellEscape(containerId)}`);
    if (!stopResult.success) {
      Logger.warn(`Failed to stop container: ${stopResult.stderr}`);
    }

    // Remove the container
    const rmResult = await this.ssh.exec(`docker rm ${shellEscape(containerId)}`);
    if (!rmResult.success) {
      Logger.warn(`Failed to remove container: ${rmResult.stderr}`);
    }

    Logger.success(`Stopped and removed container: ${containerId.substring(0, 12)}`);
  }

  async startContainer(containerId: string): Promise<void> {
    Logger.info(`Starting container: ${containerId.substring(0, 12)}`);

    const result = await this.ssh.exec(`docker start ${shellEscape(containerId)}`);
    if (!result.success) {
      throw new Error(`Failed to start container ${containerId}: ${result.stderr}`);
    }

    Logger.success(`Started container: ${containerId.substring(0, 12)}`);
  }

  async getLogs(containerId: string, tail: number = 100): Promise<string> {
    const lines = Number.isInteger(tail) && tail > 0 ? tail : 100;
    const command = `docker logs --tail ${lines} ${shellEscape(containerId)}`;
    const result = await this.ssh.exec(command);

    if (!result.success) {
      throw new Error(`Failed to get logs: ${result.stderr}`);
    }

    return result.stdout;
  }

  async isHealthy(containerId: string): Promise<boolean> {
    const command = `docker inspect --format='{{.State.Status}}' ${shellEscape(containerId)}`;
    const result = await this.ssh.exec(command);

    if (!result.success) {
      return false;
    }

    const status = result.stdout.trim();
    return status === 'running';
  }

  async listAppContainers(): Promise<Array<{ id: string; name: string }>> {
    const command = `docker ps -a --filter ${shellEscape(`name=${this.appName}`)} --format "{{.ID}}|{{.Names}}"`;
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
    const checkCommand = `docker network inspect ${shellEscape(networkName)}`;
    const checkResult = await this.ssh.exec(checkCommand);

    if (!checkResult.success) {
      Logger.info(`Creating Docker network: ${networkName}`);
      const createCommand = `docker network create ${shellEscape(networkName)}`;
      const createResult = await this.ssh.exec(createCommand);

      if (!createResult.success) {
        throw new Error(`Failed to create network: ${createResult.stderr}`);
      }

      Logger.success(`Created network: ${networkName}`);
    }
  }
}
