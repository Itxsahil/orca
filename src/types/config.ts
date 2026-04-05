export interface ServerConfig {
  /** IP address or hostname of the VPS */
  host: string;
  /** SSH username for authentication */
  user: string;
  /** Path to SSH private key file */
  ssh_key: string;
  /** SSH port for remote access */
  port: number;
}

export interface AppConfig {
  /** Unique application identifier */
  name: string;
  /** Domain name for Traefik routing */
  domain: string;
  /** Container port the application listens on */
  port: number;
  /** Docker restart policy */
  restart: 'no' | 'on-failure' | 'always' | 'unless-stopped';
  /** Docker network to attach the app container to */
  network: string;
  /** Environment variables for the app container */
  envs: Record<string, string>;
  /** Path used by HTTP health checks */
  health_check_path: string;
}

/**
 * Git repository configuration
 */
export interface GitConfig {
  /** Git URL to clone from */
  repository: string;
  /** Branch to deploy */
  branch: string;
}

/**
 * Complete Orca configuration structure
 * Represents the parsed orca.yml file
 */
export interface OrcaConfig {
  server: ServerConfig;
  git: GitConfig;
  app: AppConfig;
}

/**
 * Deployment metadata stored in Redis
 * Tracks the state of each deployment
 */
export interface DeploymentMetadata {
  /** Unique deployment ID (timestamp-based) */
  id: string;
  /** Application name */
  appName: string;
  /** Container ID running this deployment */
  containerId: string;
  /** Timestamp when deployment started */
  startedAt: string;
  /** Deployment status */
  status: 'pending' | 'running' | 'failed' | 'stopped';
  /** Git commit hash (if available) */
  commitHash?: string;
}

export interface SSHConnectionConfig {
  host: string;
  username: string;
  privateKeyPath: string;
  port?: number;
}

export interface ContainerConfig {
  /** Container name */
  name: string;
  /** Docker image to use */
  image: string;
  /** Port mapping (host:container) */
  ports: string[];
  /** Environment variables */
  env: Record<string, string>;
  /** Docker network to attach to */
  network?: string;
  /** Docker restart policy */
  restart?: 'no' | 'on-failure' | 'always' | 'unless-stopped';
  /** Volume mounts */
  volumes?: string[];
  /** Traefik routing labels */
  labels?: Record<string, string>;
}

export interface TraefikConfig {
  /** Domain name for routing */
  domain: string;
  /** Container port to route to */
  port: number;
  /** Enable SSL/TLS */
  tls: boolean;
  /** Application name for labeling */
  appName: string;
}

export interface CommandResult {
  /** Exit code (0 for success) */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether the command succeeded */
  success: boolean;
}
