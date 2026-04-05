import { createDeployService } from '../deploy/deployService';
import { Logger } from '../utils/logger';

export default async function deploy(configPath?: string): Promise<void> {
  try {
    const deployService = await createDeployService(configPath);
    await deployService.deploy();
  } catch (error) {
    Logger.error(
      `Deploy command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    process.exit(1);
  }
}
