import { loadConfig } from '../config/configLoader';
import { DockerManager } from '../docker/dockerManager';
import { SSHClient } from '../ssh/sshClient';
import { RedisStorage } from '../storage/redis';
import { SSHConnectionConfig } from '../types/config';
import { Logger } from '../utils/logger';

export default async function logs(
  options: { tail?: number; follow?: boolean } = {},
): Promise<void> {
  const tailCount = options.tail || 100;

  try {
    // Load configuration
    const config = await loadConfig();

    Logger.info(`Fetching logs for: ${config.app.name}`);

    // Connect to Redis to get the latest deployment
    const redis = new RedisStorage(config.server.host, 6379);
    await redis.connect();

    const latestDeployment = await redis.getLastSuccessfulDeployment(config.app.name);

    if (!latestDeployment) {
      Logger.error('No running deployment found');
      redis.disconnect();
      process.exit(1);
    }

    Logger.info(`Container: ${latestDeployment.containerId.substring(0, 12)}`);

    // Connect to SSH
    const sshConfig: SSHConnectionConfig = {
      host: config.server.host,
      username: config.server.user,
      privateKeyPath: config.server.ssh_key,
      port: config.server.port,
    };

    const ssh = new SSHClient(sshConfig);
    await ssh.connect();

    // Fetch logs
    const docker = new DockerManager(ssh, config.app.name);
    const logOutput = await docker.getLogs(latestDeployment.containerId, tailCount);

    // Display logs
    Logger.newline();
    Logger.raw(logOutput);

    // Cleanup
    ssh.disconnect();
    redis.disconnect();
  } catch (error) {
    Logger.error(
      `Logs command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    process.exit(1);
  }
}
