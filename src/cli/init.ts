import { createDefaultConfig } from '../config/configLoader';
import { Logger } from '../utils/logger';

// TODO: Create a orca.yml template file if it is not present already and if the flag is --no-cache then remove the older one and create a new one

export default async function init(options: { force?: boolean }): Promise<void> {
  try {
    const projectPath = process.cwd();
    await createDefaultConfig(projectPath, options.force);
  } catch (error) {
    Logger.error(
      `Init command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    process.exit(1);
  }
}
