import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  OrcaConfig,
  AppConfig,
  GitConfig,
  ServerConfig,
  SSHConnectionConfig,
} from '../types/config';
import { Logger } from '../utils/logger';
import { loadEnvFile } from './envFile';
import {
  APP_NAME_PATTERN,
  BRANCH_PATTERN,
  ENV_KEY_PATTERN,
  HOST_KEY_FINGERPRINT_PATTERN,
  NETWORK_PATTERN,
  RESTART_POLICIES,
  isValidDomain,
  isValidHealthCheckPath,
  isValidPort,
  looksLikeSecret,
} from './validators';

const CONFIG_FILE = 'orca.yml';

export async function loadConfig(configPath?: string): Promise<OrcaConfig> {
  const targetPath = path.resolve(configPath || path.join(process.cwd(), CONFIG_FILE));

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

    // Merge secrets from env_file (inline envs take precedence)
    if (normalized.app.env_file) {
      const envFilePath = path.resolve(path.dirname(targetPath), normalized.app.env_file);
      const fileEnvs = await loadEnvFile(envFilePath);
      normalized.app.envs = { ...fileEnvs, ...normalized.app.envs };
    }

    validateEnvValues(normalized.app.envs);

    Logger.info(`Loaded configuration from ${targetPath}`);

    return normalized;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse configuration: ${error.message}`);
    }
    throw new Error('Failed to parse configuration: Unknown error');
  }
}

/** Build the SSH connection settings for a loaded config. */
export function sshConfigFrom(config: OrcaConfig): SSHConnectionConfig {
  return {
    host: config.server.host,
    username: config.server.user,
    privateKeyPath: config.server.ssh_key,
    port: config.server.port,
    hostKey: config.server.host_key,
    strictHostKeyChecking: config.server.strict_host_key_checking,
  };
}

export function validateAndNormalizeConfig(config: unknown): OrcaConfig {
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
  if (server.port !== undefined && !isValidPort(server.port)) {
    throw new Error('Invalid field: server.port (must be an integer between 1 and 65535)');
  }
  if (
    server.host_key !== undefined &&
    (typeof server.host_key !== 'string' || !HOST_KEY_FINGERPRINT_PATTERN.test(server.host_key))
  ) {
    throw new Error(
      'Invalid field: server.host_key (expected a SHA256 fingerprint like "SHA256:abc...", ' +
        'see `ssh-keyscan <host> | ssh-keygen -lf -`)',
    );
  }
  if (
    server.strict_host_key_checking !== undefined &&
    typeof server.strict_host_key_checking !== 'boolean'
  ) {
    throw new Error('Invalid field: server.strict_host_key_checking (must be true or false)');
  }

  // Validate git section
  if (!c.git || typeof c.git !== 'object') {
    throw new Error('Missing required field: git');
  }

  const git = c.git as Record<string, unknown>;
  if (!git.repository || typeof git.repository !== 'string' || !git.repository.trim()) {
    throw new Error('Missing required field: git.repository');
  }
  if (git.repository.trim().startsWith('-')) {
    throw new Error('Invalid field: git.repository (must not start with "-")');
  }
  if (git.branch !== undefined && typeof git.branch !== 'string') {
    throw new Error('Invalid field: git.branch (must be a string)');
  }
  if (typeof git.branch === 'string' && git.branch.trim() && !BRANCH_PATTERN.test(git.branch)) {
    throw new Error(
      'Invalid field: git.branch (letters, digits, ".", "_", "/" and "-" only; must not start with "-")',
    );
  }

  // Validate app section
  if (!c.app || typeof c.app !== 'object') {
    throw new Error('Missing required field: app');
  }

  const app = c.app as Record<string, unknown>;
  if (!app.name || typeof app.name !== 'string' || !app.name.trim()) {
    throw new Error('Missing required field: app.name');
  }
  if (!APP_NAME_PATTERN.test(app.name)) {
    throw new Error(
      'Invalid field: app.name (lowercase letters, digits and "-" only, starting with a letter or digit, max 63 chars)',
    );
  }
  if (!app.domain || typeof app.domain !== 'string' || !app.domain.trim()) {
    throw new Error('Missing required field: app.domain');
  }
  if (!isValidDomain(app.domain)) {
    throw new Error(`Invalid field: app.domain ("${app.domain}" is not a valid hostname)`);
  }
  if (app.port === undefined) {
    throw new Error('Missing required field: app.port (must be a number)');
  }
  if (!isValidPort(app.port)) {
    throw new Error('Invalid field: app.port (must be an integer between 1 and 65535)');
  }
  if (
    app.restart !== undefined &&
    (typeof app.restart !== 'string' ||
      !(RESTART_POLICIES as readonly string[]).includes(app.restart))
  ) {
    throw new Error(`Invalid field: app.restart (must be one of: ${RESTART_POLICIES.join(', ')})`);
  }
  if (app.network !== undefined && typeof app.network !== 'string') {
    throw new Error('Invalid field: app.network (must be a string)');
  }
  if (typeof app.network === 'string' && app.network.trim() && !NETWORK_PATTERN.test(app.network)) {
    throw new Error(
      'Invalid field: app.network (letters, digits, "_", "." and "-" only, starting with a letter or digit)',
    );
  }
  if (
    app.envs !== undefined &&
    app.envs !== null &&
    (typeof app.envs !== 'object' || Array.isArray(app.envs))
  ) {
    throw new Error('Invalid field: app.envs (must be a map of KEY: value)');
  }
  if (app.env_file !== undefined && (typeof app.env_file !== 'string' || !app.env_file.trim())) {
    throw new Error('Invalid field: app.env_file (must be a file path)');
  }
  if (app.health_check_path !== undefined && typeof app.health_check_path !== 'string') {
    throw new Error('Invalid field: app.health_check_path (must be a string)');
  }
  if (
    typeof app.health_check_path === 'string' &&
    app.health_check_path.trim() &&
    !isValidHealthCheckPath(app.health_check_path)
  ) {
    throw new Error('Invalid field: app.health_check_path (must be a URL path starting with "/")');
  }

  const inlineEnvs = normalizeEnvs(app.envs);
  warnAboutInlineSecrets(inlineEnvs);

  const serverConfig: ServerConfig = {
    host: server.host,
    user: server.user,
    ssh_key: server.ssh_key,
    port: typeof server.port === 'number' ? server.port : 22,
    host_key: typeof server.host_key === 'string' ? server.host_key : undefined,
    strict_host_key_checking: server.strict_host_key_checking === true,
  };

  const gitConfig: GitConfig = {
    repository: git.repository.trim(),
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
    envs: inlineEnvs,
    env_file: typeof app.env_file === 'string' ? app.env_file : undefined,
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
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(
        `Invalid field: app.envs.${key} (names must match ${ENV_KEY_PATTERN.source})`,
      );
    }
    if (value === null || typeof value === 'object') {
      throw new Error(`Invalid field: app.envs.${key} (value must be a string, number or boolean)`);
    }
    normalized[key] = String(value);
  }

  return normalized;
}

/** Docker's --env-file format cannot represent line breaks or NUL bytes. */
function validateEnvValues(envs: Record<string, string>): void {
  for (const [key, value] of Object.entries(envs)) {
    if (/[\r\n\0]/.test(value)) {
      throw new Error(
        `Environment variable ${key} contains a line break, which Docker env files cannot carry. ` +
          'Base64-encode multi-line values instead.',
      );
    }
  }
}

function warnAboutInlineSecrets(envs: Record<string, string>): void {
  const suspicious = Object.keys(envs).filter(looksLikeSecret);
  if (suspicious.length > 0) {
    Logger.warn(
      `app.envs contains what look like secrets (${suspicious.join(', ')}). ` +
        'orca.yml is usually committed to git; move them to an env_file (e.g. .env) that is gitignored.',
    );
  }
}

const DEFAULT_CONFIG_TEMPLATE = `server:
  host: your-server-ip
  user: deploy
  ssh_key: ~/.ssh/id_rsa
  port: 22
  # Optional: pin the server's host key (get it with: ssh-keyscan <host> | ssh-keygen -lf -)
  # host_key: SHA256:...
  # Refuse servers whose host key is not already known (recommended for CI)
  strict_host_key_checking: false

git:
  repository: git@github.com:your-org/your-repo.git
  branch: main

app:
  name: myapp
  domain: myapp.com
  port: 3000
  network: traefik
  restart: unless-stopped
  health_check_path: /
  # Non-secret settings can go here. orca.yml is meant to be committed.
  envs:
    NODE_ENV: production
  # Secrets (API keys, database passwords, ...) go in a gitignored dotenv file.
  # env_file: .env
`;

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

  Logger.info('Initializing configuration...');
  await fs.writeFile(configPath, DEFAULT_CONFIG_TEMPLATE, 'utf-8');

  Logger.success(`Created ${CONFIG_FILE} in ${projectPath}`);
  Logger.newline();
  Logger.success('Orca project initialized!');
  Logger.info('Next steps:');
  Logger.info('1. Edit orca.yml with your server details');
  Logger.info('2. Put secrets in a .env file (and make sure .env is in .gitignore)');
  Logger.info('3. Run "orca doctor" to run preflight checks');
  Logger.info('4. Run "orca deploy" to deploy your application');
}
