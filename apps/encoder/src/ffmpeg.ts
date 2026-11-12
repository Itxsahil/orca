import { spawn } from 'node:child_process';

export class ProcessError extends Error {
  constructor(
    message: string,
    public stderr: string,
  ) {
    super(message);
  }
}

/**
 * Runs ffmpeg/ffprobe. Returns stdout. `onLine` sees stdout line by line
 * (ffmpeg -progress pipe:1). The process is killed when `signal` aborts.
 */
export function run(
  cmd: 'ffmpeg' | 'ffprobe',
  args: string[],
  signal: AbortSignal,
  onLine?: (line: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let partial = '';
    let stderr = '';
    const kill = () => child.kill('SIGKILL');
    signal.addEventListener('abort', kill, { once: true });

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (!onLine) return void (stdout += chunk);
      partial += chunk;
      const lines = partial.split('\n');
      partial = lines.pop()!;
      for (const line of lines) onLine(line);
    });
    // Keep only the end of stderr: ffmpeg's last lines say what went wrong.
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on('error', (err) => {
      signal.removeEventListener('abort', kill);
      reject(err);
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', kill);
      if (signal.aborted) return reject(signal.reason ?? new Error('aborted'));
      if (code === 0) return resolve(stdout);
      reject(new ProcessError(`${cmd} exited with code ${code}`, stderr));
    });
  });
}
