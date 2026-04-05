import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { OrcaConfig, AppConfig, GitConfig, ServerConfig } from '../types/config';
import { Logger } from '../utils/logger';

const CONFIG_FILE = 'orca.yml';

export async function loadConfig(configPath?: string): Promise<OrcaConfig> {
  const targetPath = configPath || path.join(process.cwd(), CONFIG_FILE);

  // Check if file exists
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(
      `Configuration file not found: ${targetPath}\n` +
        `Run 'orca init' to create a new configuration.`,
    );
  }

  try {
    // Read and parse YAML file
    const fileContent = await fs.readFile(targetPath, 'utf-8');
    const parsed = YAML.parse(fileContent);

    // Validate and normalize configuration
    const normalized = validateAndNormalizeConfig(parsed);

    Logger.info(`Loaded configuration from ${targetPath}`);

    return normalized;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse configuration: ${error.message}`);
    }
    throw new Error('Failed to parse configuration: Unknown error');
  }
}

function validateAndNormalizeConfig(config: unknown): OrcaConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Configuration must be an object');
  }

  const c = config as Record<string, unknown>;

  // Validate server section
  if (!c.server || typeof c.server !== 'object') {
    throw new Error('Missing required field: server');
  }

  const server = c.server as Record<string, unknown>;
  if (!server.host || typeof server.host !== 'string' || !server.host.trim()) {
    throw new Error('Missing required field: server.host');
  }
  if (!server.user || typeof server.user !== 'string' || !server.user.trim()) {
    throw new Error('Missing required field: server.user');
  }
  if (!server.ssh_key || typeof server.ssh_key !== 'string' || !server.ssh_key.trim()) {
    throw new Error('Missing required field: server.ssh_key');
  }
  if (server.port !== undefined && (typeof server.port !== 'number' || Number.isNaN(server.port))) {
    throw new Error('Invalid field: server.port (must be a number)');
  }

  // Validate git section
  if (!c.git || typeof c.git !== 'object') {
    throw new Error('Missing required field: git');
  }

  const git = c.git as Record<string, unknown>;
  if (!git.repository || typeof git.repository !== 'string' || !git.repository.trim()) {
    throw new Error('Missing required field: git.repository');
  }
  if (git.branch !== undefined && typeof git.branch !== 'string') {
    throw new Error('Invalid field: git.branch (must be a string)');
  }

  // Validate app section
  if (!c.app || typeof c.app !== 'object') {
    throw new Error('Missing required field: app');
  }

  const app = c.app as Record<string, unknown>;
  if (!app.name || typeof app.name !== 'string' || !app.name.trim()) {
    throw new Error('Missing required field: app.name');
  }
  if (!app.domain || typeof app.domain !== 'string' || !app.domain.trim()) {
    throw new Error('Missing required field: app.domain');
  }
  if (!app.port || typeof app.port !== 'number') {
    throw new Error('Missing required field: app.port (must be a number)');
  }
  if (app.restart !== undefined && typeof app.restart !== 'string') {
    throw new Error('Invalid field: app.restart (must be a string)');
  }
  if (app.network !== undefined && typeof app.network !== 'string') {
    throw new Error('Invalid field: app.network (must be a string)');
  }
  if (app.envs !== undefined && (typeof app.envs !== 'object' || app.envs === null)) {
    throw new Error('Invalid field: app.envs (must be an object)');
  }
  if (app.health_check_path !== undefined && typeof app.health_check_path !== 'string') {
    throw new Error('Invalid field: app.health_check_path (must be a string)');
  }

  const serverConfig: ServerConfig = {
    host: server.host,
    user: server.user,
    ssh_key: server.ssh_key,
    port: typeof server.port === 'number' ? server.port : 22,
  };

  const gitConfig: GitConfig = {
    repository: git.repository,
    branch: typeof git.branch === 'string' && git.branch.trim() ? git.branch : 'main',
  };

  const appConfig: AppConfig = {
    name: app.name,
    domain: app.domain,
    port: app.port,
    restart: (typeof app.restart === 'string'
      ? app.restart
      : 'unless-stopped') as AppConfig['restart'],
    network: typeof app.network === 'string' && app.network.trim() ? app.network : 'traefik',
    envs: normalizeEnvs(app.envs),
    health_check_path:
      typeof app.health_check_path === 'string' && app.health_check_path.trim()
        ? app.health_check_path
        : '/',
  };

  return {
    server: serverConfig,
    git: gitConfig,
    app: appConfig,
  };
}

function normalizeEnvs(envs: unknown): Record<string, string> {
  if (!envs || typeof envs !== 'object') {
    return {};
  }

  const source = envs as Record<string, unknown>;
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    normalized[key] = String(value);
  }

  return normalized;
}

export async function createDefaultConfig(
  projectPath: string,
  force: boolean = false,
): Promise<void> {
  const configPath = path.join(projectPath, CONFIG_FILE);

  let exists = false;

  try {
    await fs.access(configPath);
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    if (!force) {
      Logger.info('Configuration file already exists, skipping creation');
      Logger.info('Use --force to overwrite the existing configuration');
      return;
    }

    // overwrite case
    await fs.unlink(configPath);
  }

  const defaultConfig = {
    server: {
      host: 'your-server-ip',
      user: 'deploy',
      ssh_key: '~/.ssh/id_rsa',
      port: 22,
    },
    git: {
      repository: 'git@github.com:your-org/your-repo.git',
      branch: 'main',
    },
    app: {
      name: 'myapp',
      domain: 'myapp.com',
      port: 3000,
      network: 'traefik',
      restart: 'unless-stopped',
      health_check_path: '/',
      envs: {
        NODE_ENV: 'production',
      },
    },
  };

  const yamlContent = YAML.stringify(defaultConfig);

  Logger.info('Initializing configuration...');
  await fs.writeFile(configPath, yamlContent, 'utf-8');

  Logger.success(`Created ${CONFIG_FILE} in ${projectPath}`);
  Logger.newline();
  Logger.success('Orca project initialized!');
  Logger.info('Next steps:');
  Logger.info('1. Edit orca.yml with your server details');
  Logger.info('2. Run "orca doctor" to run preflight checks');
  Logger.info('3. Run "orca deploy" to deploy your application');
}
