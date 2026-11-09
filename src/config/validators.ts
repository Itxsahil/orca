/**
 * Strict formats for values that end up in shell commands, Docker flags or
 * Traefik rules. Validating them up front means a typo (or a malicious
 * orca.yml) fails loudly instead of being interpreted by a remote shell.
 */

/** Docker container/image name and Traefik router name. */
export const APP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Docker network name. */
export const NETWORK_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/** POSIX-style environment variable name. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Git branch name: no leading dash (option injection) and no shell/ref metacharacters. */
export const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;

/** SSH SHA256 host key fingerprint, as printed by `ssh-keygen -lf`. */
export const HOST_KEY_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}=?$/;

export const RESTART_POLICIES = ['no', 'on-failure', 'always', 'unless-stopped'] as const;

/** Hostname label rules from RFC 1123, plus an optional leading wildcard label. */
export function isValidDomain(domain: string): boolean {
  if (domain.length > 253) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every(
    (label, i) =>
      (i === 0 && label === '*') || /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
  );
}

export function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** HTTP path used for health checks; restricted so it is safe inside a URL and a shell word. */
export function isValidHealthCheckPath(path: string): boolean {
  return /^\/[A-Za-z0-9._~\-/?=&%]*$/.test(path);
}

/** Inline env var names that probably hold secrets and belong in env_file instead. */
export function looksLikeSecret(key: string): boolean {
  return /(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL)/i.test(key);
}
