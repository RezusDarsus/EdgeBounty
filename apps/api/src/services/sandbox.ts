import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Config } from '../config.js';

const activeSandboxes = new Set<() => Promise<void>>();
export async function stopSandboxes() {
  await Promise.allSettled([...activeSandboxes].map(stop => stop()));
}

export interface SandboxRun {
  /** Script path relative to the repo `services/` dir, e.g. `dataset-validator/validate.py`. */
  script: string;
  args: string[];
  /** Host directories: input is mounted read-only, output read-write. */
  inputDir: string;
  outputDir: string;
  timeoutMs: number;
  memoryMb?: number;
}

export interface SandboxResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  elapsedMs: number;
}

/**
 * Runs untrusted-input analysis outside the API process.
 * - `process`: child process with a scrubbed environment (no secrets), wall-clock kill. Dev only.
 * - `docker`: `--network none`, read-only root FS, non-root user, memory/CPU/PID limits,
 *   input mounted read-only, tmpfs scratch. Required in production (enforced in config).
 */
export function runSandboxed(cfg: Config, r: SandboxRun): Promise<SandboxResult> {
  const started = Date.now();
  let cmd: string;
  let argv: string[];
  const container = `edgebounty-job-${randomUUID()}`;
  // paths inside args use the placeholders {in} / {out}
  if (cfg.SANDBOX === 'docker') {
    const sub = (a: string) => a.replaceAll('{in}', '/work/in').replaceAll('{out}', '/work/out');
    cmd = cfg.DOCKER_USE_SUDO === '1' ? 'sudo' : 'docker';
    argv = [
      ...(cfg.DOCKER_USE_SUDO === '1' ? ['-n', 'docker'] : []),
      'run', '--rm', '--name', container, '--network', 'none', '--read-only', '--user', `${process.getuid?.() || 65534}:${process.getgid?.() || 65534}`,
      '--memory', `${r.memoryMb ?? 2048}m`, '--cpus', '2', '--pids-limit', '256',
      '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
      '--tmpfs', '/tmp:rw,size=512m',
      '-v', `${r.inputDir}:/work/in:ro`,
      '-v', `${r.outputDir}:/work/out:rw`,
      'edgebounty/validators:latest',
      'python', `/app/${r.script}`, ...r.args.map(sub),
    ];
  } else {
    const sub = (a: string) => a.replaceAll('{in}', r.inputDir).replaceAll('{out}', r.outputDir);
    cmd = cfg.pythonBin;
    argv = ['-I', join(cfg.repoRoot, 'services', r.script), ...r.args.map(sub)];
  }
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
  if (process.platform === 'win32') env.SYSTEMROOT = process.env.SYSTEMROOT;
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd: r.outputDir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stop = async () => {
      child.kill('SIGKILL');
      if (cfg.SANDBOX === 'docker') {
        await new Promise<void>(done => {
          const cleanup = spawn(cmd, [...(cfg.DOCKER_USE_SUDO === '1' ? ['-n', 'docker'] : []), 'rm', '-f', container], { env, stdio: 'ignore', windowsHide: true });
          const kill = setTimeout(() => { cleanup.kill('SIGKILL'); done(); }, 5000);
          cleanup.on('error', () => { clearTimeout(kill); done(); });
          cleanup.on('close', () => { clearTimeout(kill); done(); });
        });
      }
    };
    activeSandboxes.add(stop);
    let stdout = '';
    let stderr = '';
    const cap = (s: string, add: Buffer) => (s + add.toString()).slice(0, 200_000);
    child.stdout.on('data', (d) => (stdout = cap(stdout, d)));
    child.stderr.on('data', (d) => (stderr = cap(stderr, d)));
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      void stop();
    }, r.timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      activeSandboxes.delete(stop);
      resolve({ code, stdout, stderr, timedOut, elapsedMs: Date.now() - started });
    });
    child.on('error', (e) => {
      clearTimeout(t);
      activeSandboxes.delete(stop);
      resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut, elapsedMs: Date.now() - started });
    });
  });
}
