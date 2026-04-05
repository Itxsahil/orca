import { loadConfig } from '../config/configLoader';
import { SSHClient } from '../ssh/sshClient';
import { SSHConnectionConfig } from '../types/config';
import { Logger } from '../utils/logger';

interface CheckResult {
  name: string;
  ok: boolean;
  details?: string;
}

export default async function doctor(configPath?: string): Promise<void> {
  const checks: CheckResult[] = [];
  let ssh: SSHClient | null = null;

  try {
    const config = await loadConfig(configPath);

    const sshConfig: SSHConnectionConfig = {
      host: config.server.host,
      username: config.server.user,
      privateKeyPath: config.server.ssh_key,
      port: config.server.port,
    };

    ssh = new SSHClient(sshConfig);
    await ssh.connect();
    checks.push({ name: 'SSH connectivity', ok: true });

    checks.push(await runRemoteCheck(ssh, 'Docker installed', 'command -v docker'));
    checks.push(await runRemoteCheck(ssh, 'Git installed', 'command -v git'));
    checks.push(await runRemoteCheck(ssh, 'Can run Docker', 'docker ps >/dev/null 2>&1'));
    checks.push(
      await runRemoteCheck(
        ssh,
        'Repository reachable',
        `git ls-remote --heads ${shellEscape(config.git.repository)} ${shellEscape(config.git.branch)} >/dev/null 2>&1`,
      ),
    );
    checks.push(
      await runRemoteCheck(
        ssh,
        'Ports 80/443 available',
        '! (ss -lnt 2>/dev/null | awk "{print \\$4}" | grep -Eq "(:80|:443)$")',
      ),
    );
  } catch (error) {
    Logger.error(
      `Doctor command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    process.exit(1);
  } finally {
    if (ssh) {
      ssh.disconnect();
    }
  }

  Logger.newline();
  Logger.info('Preflight report');
  for (const check of checks) {
    if (check.ok) {
      Logger.success(`${check.name}`);
    } else {
      Logger.error(`${check.name}${check.details ? ` (${check.details})` : ''}`);
    }
  }

  const hasFailure = checks.some((c) => !c.ok);
  if (hasFailure) {
    Logger.newline();
    Logger.error('Preflight failed. Fix the failing checks before deployment.');
    process.exit(1);
  }

  Logger.newline();
  Logger.success('All preflight checks passed.');
}

async function runRemoteCheck(ssh: SSHClient, name: string, command: string): Promise<CheckResult> {
  const result = await ssh.exec(command);
  return {
    name,
    ok: result.success,
    details: result.success ? undefined : result.stderr || result.stdout || 'check failed',
  };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
