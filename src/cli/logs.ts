import { loadConfig, sshConfigFrom } from '../config/configLoader';
import { DockerManager } from '../docker/dockerManager';
import { SSHClient } from '../ssh/sshClient';
import { RedisStorage } from '../storage/redis';
import { Logger } from '../utils/logger';

export default async function logs(
  options: { tail?: number; follow?: boolean } = {},
): Promise<void> {
  const tailCount = options.tail || 100;

  try {
    // Load configuration
    const config = await loadConfig();

    Logger.info(`Fetching logs for: ${config.app.name}`);

    // Connect over SSH first; Redis is only reachable through the SSH connection
    const ssh = new SSHClient(sshConfigFrom(config));
    await ssh.connect();

    const redis = new RedisStorage(ssh);
    await redis.connect();

    const latestDeployment = await redis.getLastSuccessfulDeployment(config.app.name);

    if (!latestDeployment) {
      Logger.error('No running deployment found');
      redis.disconnect();
      ssh.disconnect();
      process.exit(1);
    }

    Logger.info(`Container: ${latestDeployment.containerId.substring(0, 12)}`);

    // Fetch logs
    const docker = new DockerManager(ssh, config.app.name);
    const logOutput = await docker.getLogs(latestDeployment.containerId, tailCount);

    // Display logs
    Logger.newline();
    Logger.raw(logOutput);

    // Cleanup (Redis first: it runs over the SSH tunnel)
    redis.disconnect();
    ssh.disconnect();
  } catch (error) {
    Logger.error(
      `Logs command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    process.exit(1);
  }
}
