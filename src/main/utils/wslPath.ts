/**
 * WSL path utilities and exec wrappers.
 *
 * When a project lives on the WSL filesystem (\\wsl$\<distro>\... or
 * \\wsl.localhost\<distro>\...), Windows-native git and shell commands fail.
 * These helpers detect WSL UNC paths, convert them to POSIX paths, and
 * transparently route child_process calls through `wsl.exe`.
 *
 * For non-WSL paths every wrapper behaves identically to the standard
 * Node.js `execFile` / `exec` equivalents so they are safe drop-in replacements.
 */

import os from 'os';
import { execFile, exec, type ExecFileOptions, type ExecOptions } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const nodeExecFile = promisify(execFile);
const nodeExec = promisify(exec);

// ── Path utilities (pure functions) ─────────────────────────────────

const WSL_UNC_RE = /^[\\/]{2}(?:wsl\$|wsl\.localhost)[\\/]([^\\/]+)/i;

/** Detect `\\wsl$\<distro>\...` and `\\wsl.localhost\<distro>\...` paths. */
export function isWslPath(p: string): boolean {
  return WSL_UNC_RE.test(p);
}

/** Extract the WSL distro name from a UNC path, or `null` for non-WSL paths. */
export function getWslDistro(p: string): string | null {
  const m = p.match(WSL_UNC_RE);
  return m ? m[1] : null;
}

/**
 * Convert a WSL UNC path to its POSIX equivalent inside the distro.
 *
 *   `\\wsl$\Ubuntu\home\user\project` → `/home/user/project`
 *   `\\wsl.localhost\Ubuntu\`         → `/`
 *
 * Throws for non-WSL paths.
 */
export function toWslPosixPath(uncPath: string): string {
  const m = uncPath.match(WSL_UNC_RE);
  if (!m) throw new Error(`Not a WSL UNC path: ${uncPath}`);

  // Everything after \\wsl$\<distro> is the POSIX path.
  const afterDistro = uncPath.slice(m[0].length);
  const posix = afterDistro.replace(/\\/g, '/');
  return posix || '/';
}

/**
 * Convert a POSIX path + distro back to a Windows UNC path.
 *
 *   `('Ubuntu', '/home/user')` → `\\wsl$\Ubuntu\home\user`
 */
export function toWindowsUncPath(distro: string, posixPath: string): string {
  const winSegments = posixPath.replace(/\//g, '\\');
  return `\\\\wsl$\\${distro}${winSegments}`;
}

// ── Exec wrappers ───────────────────────────────────────────────────

/**
 * Drop-in replacement for `promisify(execFile)`.
 *
 * When `options.cwd` is a WSL UNC path the command is routed through
 * `wsl.exe -d <distro> --cd <posixCwd> -- <command> <args>`.
 *
 * For non-WSL paths it delegates directly to Node's `execFile`.
 */
export async function wslExecFile(
  file: string,
  args?: readonly string[] | null,
  options?: ExecFileOptions
): Promise<{ stdout: string; stderr: string }> {
  const cwd = options?.cwd?.toString();
  if (!cwd || !isWslPath(cwd)) {
    return nodeExecFile(file, args ?? [], options ?? {}) as Promise<{
      stdout: string;
      stderr: string;
    }>;
  }

  const distro = getWslDistro(cwd)!;
  const posixCwd = toWslPosixPath(cwd);

  // Strip Windows executable extensions and use basename only – inside WSL
  // the binary is a Linux ELF, not a .exe/.cmd.
  const base = path.basename(file).replace(/\.(exe|cmd|bat)$/i, '');

  const wslArgs = ['-d', distro, '--cd', posixCwd, '--', base, ...(args ?? [])];

  const wslOptions: ExecFileOptions = {
    ...options,
    cwd: os.homedir(), // safe Windows-side cwd for wsl.exe
  };

  return nodeExecFile('wsl.exe', wslArgs, wslOptions) as Promise<{
    stdout: string;
    stderr: string;
  }>;
}

/**
 * Drop-in replacement for `promisify(exec)`.
 *
 * When `options.cwd` is a WSL UNC path the command string is wrapped with
 * `wsl.exe -d <distro> --cd <posixCwd> -- sh -c '<command>'`.
 *
 * For non-WSL paths it delegates directly to Node's `exec`.
 */
export async function wslExec(
  command: string,
  options?: ExecOptions
): Promise<{ stdout: string; stderr: string }> {
  const cwd = options?.cwd?.toString();
  if (!cwd || !isWslPath(cwd)) {
    return nodeExec(command, options ?? {}) as Promise<{ stdout: string; stderr: string }>;
  }

  const distro = getWslDistro(cwd)!;
  const posixCwd = toWslPosixPath(cwd);

  // Escape the command for embedding in single quotes inside sh -c.
  const escaped = command.replace(/'/g, "'\\''");

  const wslCommand = `wsl.exe -d ${distro} --cd ${posixCwd} -- sh -c '${escaped}'`;

  const wslOptions: ExecOptions = {
    ...options,
    cwd: os.homedir(),
  };

  return nodeExec(wslCommand, wslOptions) as Promise<{ stdout: string; stderr: string }>;
}

// ── PTY helper ──────────────────────────────────────────────────────

export interface WslPtyConfig {
  shell: string;
  args: string[];
  cwd: string;
  distro: string;
  posixCwd: string;
}

/**
 * Return PTY spawn parameters for a WSL UNC path, or `null` for non-WSL paths.
 *
 * Usage:
 * ```ts
 * const cfg = getWslPtyConfig(taskPath);
 * if (cfg) pty.spawn(cfg.shell, cfg.args, { cwd: cfg.cwd, ... });
 * ```
 */
export function getWslPtyConfig(wslUncPath: string): WslPtyConfig | null {
  if (!isWslPath(wslUncPath)) return null;

  const distro = getWslDistro(wslUncPath)!;
  const posixCwd = toWslPosixPath(wslUncPath);

  return {
    shell: 'wsl.exe',
    args: ['-d', distro, '--cd', posixCwd],
    cwd: os.homedir(),
    distro,
    posixCwd,
  };
}
