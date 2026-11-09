import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface KnownHostEntry {
  keyType: string;
  /** Base64 of the SSH wire-format public key blob */
  keyBase64: string;
  source: string;
}

export type HostKeyVerdict =
  | { status: 'match'; source: string }
  | { status: 'mismatch'; known: KnownHostEntry[] }
  | { status: 'unknown' };

/** File where Orca remembers host keys it trusted on first use. */
export function orcaKnownHostsPath(): string {
  return path.join(os.homedir(), '.orca', 'known_hosts');
}

export function defaultKnownHostsFiles(): string[] {
  return [path.join(os.homedir(), '.ssh', 'known_hosts'), orcaKnownHostsPath()];
}

/** The name OpenSSH uses for a host in known_hosts: `host`, or `[host]:port` for non-22 ports. */
export function knownHostsName(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

/** OpenSSH-style fingerprint of a raw public key blob: `SHA256:<base64, no padding>`. */
export function fingerprint(keyBlob: Buffer): string {
  return `SHA256:${crypto.createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`;
}

/** Read the algorithm name (e.g. "ssh-ed25519") embedded at the start of a key blob. */
export function keyTypeOf(keyBlob: Buffer): string {
  if (keyBlob.length < 4) return 'unknown';
  const len = keyBlob.readUInt32BE(0);
  return keyBlob.subarray(4, 4 + len).toString('ascii');
}

/** All known keys for a host across the given known_hosts files. */
export function findKnownKeys(
  host: string,
  port: number,
  files: string[] = defaultKnownHostsFiles(),
): KnownHostEntry[] {
  const name = knownHostsName(host, port);
  const entries: KnownHostEntry[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      // Skip comments and @cert-authority / @revoked marker lines.
      if (!line || line.startsWith('#') || line.startsWith('@')) continue;

      const [hostField, keyType, keyBase64] = line.split(/\s+/);
      if (!hostField || !keyType || !keyBase64) continue;

      if (hostFieldMatches(hostField, name)) {
        entries.push({ keyType, keyBase64, source: file });
      }
    }
  }

  return entries;
}

export function verifyHostKey(
  host: string,
  port: number,
  keyBlob: Buffer,
  files: string[] = defaultKnownHostsFiles(),
): HostKeyVerdict {
  const known = findKnownKeys(host, port, files);
  if (known.length === 0) return { status: 'unknown' };

  const presented = keyBlob.toString('base64');
  const hit = known.find((entry) => entry.keyBase64 === presented);
  return hit ? { status: 'match', source: hit.source } : { status: 'mismatch', known };
}

/** Remember a host key in ~/.orca/known_hosts (trust on first use). */
export function rememberHostKey(host: string, port: number, keyBlob: Buffer): string {
  const file = orcaKnownHostsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const line = `${knownHostsName(host, port)} ${keyTypeOf(keyBlob)} ${keyBlob.toString('base64')}\n`;
  fs.appendFileSync(file, line, { mode: 0o600 });
  return file;
}

function hostFieldMatches(hostField: string, name: string): boolean {
  // Hashed entry: |1|base64(salt)|base64(HMAC-SHA1(salt, name))
  if (hostField.startsWith('|1|')) {
    const [, , salt, hash] = hostField.split('|');
    if (!salt || !hash) return false;
    const digest = crypto
      .createHmac('sha1', Buffer.from(salt, 'base64'))
      .update(name)
      .digest('base64');
    return digest === hash;
  }

  // Comma-separated patterns; a matching negated pattern (!pattern) excludes the host.
  let matched = false;
  for (const pattern of hostField.split(',')) {
    if (pattern.startsWith('!')) {
      if (globMatch(pattern.slice(1), name)) return false;
    } else if (globMatch(pattern, name)) {
      matched = true;
    }
  }
  return matched;
}

function globMatch(pattern: string, value: string): boolean {
  if (!/[*?]/.test(pattern)) return pattern.toLowerCase() === value.toLowerCase();
  const regex = new RegExp(
    '^' +
      pattern
        .split('')
        .map((ch) =>
          ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&'),
        )
        .join('') +
      '$',
    'i',
  );
  return regex.test(value);
}

/**
 * ssh2 host key algorithm names that let the server present a key of the given
 * known_hosts type, so we negotiate a key type we can actually verify.
 */
export function algorithmsForKeyType(keyType: string): string[] {
  if (keyType === 'ssh-rsa') return ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'];
  return [keyType];
}
