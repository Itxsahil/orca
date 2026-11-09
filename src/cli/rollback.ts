import { loadConfig, sshConfigFrom } from '../config/configLoader';
import { DockerManager } from '../docker/dockerManager';
import { SSHClient } from '../ssh/sshClient';
import { RedisStorage } from '../storage/redis';
import { Logger } from '../utils/logger';

export default async function rollback(): Promise<void> {
  try {
    // Load configuration
    const config = await loadConfig();

    Logger.info(`Rolling back: ${config.app.name}`);

    // Connect over SSH first; Redis is only reachable through the SSH connection
    const ssh = new SSHClient(sshConfigFrom(config));
    await ssh.connect();

    const redis = new RedisStorage(ssh);
    await redis.connect();

    // Get deployment history
    const history = await redis.getDeploymentHistory(config.app.name, 5);

    if (history.length < 2) {
      Logger.error('Not enough deployments to rollback. Need at least 2 deployments.');
      redis.disconnect();
      ssh.disconnect();
      process.exit(1);
    }

    // Current deployment is most recent
    const currentDeployment = history[0];
    // Previous deployment is second most recent
    const previousDeployment = history[1];

    Logger.info(`Current deployment: ${currentDeployment.id}`);
    Logger.info(`Rolling back to: ${previousDeployment.id}`);

    // Check if previous deployment is still valid
    if (previousDeployment.status !== 'running') {
      Logger.warn(`Previous deployment status: ${previousDeployment.status}`);
      Logger.warn('The previous container may need to be restarted.');
    }

    const docker = new DockerManager(ssh, config.app.name);

    // Stop current deployment
    Logger.step(1, 'Stopping current deployment...');
    await docker.stopContainer(currentDeployment.containerId);
    await redis.updateDeploymentStatus(config.app.name, currentDeployment.id, 'stopped');

    // Ensure previous container is running (start if stopped)
    Logger.step(2, 'Restoring previous deployment...');
    const isHealthy = await docker.isHealthy(previousDeployment.containerId);

    if (!isHealthy) {
      Logger.info('Previous container is not running, attempting to start...');
      await docker.startContainer(previousDeployment.containerId);
    }

    // Update status in Redis
    await redis.updateDeploymentStatus(config.app.name, previousDeployment.id, 'running');

    Logger.newline();
    Logger.success('Rollback completed!');
    Logger.success(`Active container: ${previousDeployment.containerId.substring(0, 12)}`);
    Logger.success(`URL: https://${config.app.domain}`);

    // Cleanup (Redis first: it runs over the SSH tunnel)
    redis.disconnect();
    ssh.disconnect();
  } catch (error) {
    Logger.error(
      `Rollback command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    process.exit(1);
  }
}
