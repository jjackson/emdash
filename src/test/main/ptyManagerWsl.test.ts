import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// --- Static mocks (hoisted, intercepting top-level imports) ---

const providerStatusGetMock = vi.fn();
const getProviderCustomConfigMock = vi.fn();

vi.mock('../../main/services/providerStatusCache', () => ({
  providerStatusCache: {
    get: providerStatusGetMock,
  },
}));

vi.mock('../../main/settings', () => ({
  getProviderCustomConfig: getProviderCustomConfigMock,
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../main/errorTracking', () => ({
  errorTracking: {
    captureAgentSpawnError: vi.fn(),
    captureCriticalError: vi.fn(),
  },
}));

// Store original platform so we can restore it
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

describe('ptyManager WSL spawn', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    providerStatusGetMock.mockReturnValue(undefined);
    getProviderCustomConfigMock.mockReturnValue(undefined);

    // Pretend we're on Windows
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
    }
  });

  it('spawns provider CLI via wsl.exe with bare command name (no Windows path)', async () => {
    const { computePtySpawnConfig } = await import('../../main/services/ptyManager');

    const result = computePtySpawnConfig({
      id: 'claude-main-wsl-test-1',
      cwd: '\\\\wsl$\\Ubuntu\\home\\user\\project',
      shell: 'claude',
    });

    expect(result.command).toBe('wsl.exe');
    expect(result.args[0]).toBe('-d');
    expect(result.args[1]).toBe('Ubuntu');
    expect(result.args[2]).toBe('--cd');
    expect(result.args[3]).toBe('/home/user/project');
    expect(result.args[4]).toBe('--');
    expect(result.args[5]).toBe('bash');

    // The chain command should use bare 'claude', not a Windows path
    const chainArg = result.args[6];
    const chainCommand: string = result.args[7];
    expect(chainArg).toBe('-lic');
    expect(chainCommand).toMatch(/^claude\b/);
    // Must NOT contain Windows paths or .exe
    expect(chainCommand).not.toMatch(/\.exe/i);
    expect(chainCommand).not.toMatch(/C:\\/i);
    // Should chain back to bash after provider exits
    expect(chainCommand).toContain("exec 'bash' -il");

    // cwd must be a safe Windows-side path, not the WSL UNC path
    expect(result.cwd).not.toMatch(/\\\\wsl/);
  });

  it('spawns plain shell via wsl.exe without provider detection', async () => {
    const { computePtySpawnConfig } = await import('../../main/services/ptyManager');

    const result = computePtySpawnConfig({
      id: 'shell-main-wsl-test-2',
      cwd: '\\\\wsl.localhost\\Ubuntu\\home\\user\\project',
      // No shell specified — defaults to bash inside WSL
    });

    expect(result.command).toBe('wsl.exe');
    expect(result.args).toContain('-d');
    expect(result.args).toContain('Ubuntu');
    expect(result.args).toContain('--cd');
    expect(result.args).toContain('/home/user/project');

    // Must NOT contain cmd.exe or any Windows shell
    const argsJoined = result.args.join(' ');
    expect(argsJoined).not.toContain('cmd.exe');
    expect(argsJoined).not.toContain('powershell');

    // cwd must be a safe Windows-side path
    expect(result.cwd).not.toMatch(/\\\\wsl/);

    // Shell should be bash, not a Windows default
    expect(result.shell).toBe('bash');
  });

  it('does not resolve CLI via Windows "where" when cwd is WSL', async () => {
    const { computePtySpawnConfig } = await import('../../main/services/ptyManager');

    const result = computePtySpawnConfig({
      id: 'claude-main-wsl-test-3',
      cwd: '\\\\wsl$\\Ubuntu\\home\\user\\project',
      shell: 'claude',
    });

    // Find the chain command arg that contains the CLI invocation
    const chainCommand = result.args.find(
      (a: string) => typeof a === 'string' && a.includes('claude')
    );

    // The command must be bare 'claude', not a resolved Windows path
    expect(chainCommand).toBeDefined();
    expect(chainCommand).not.toContain('\\');
    expect(chainCommand).not.toMatch(/\.exe/i);
  });

  it('startDirectPty returns null for WSL paths', async () => {
    const { startDirectPty } = await import('../../main/services/ptyManager');

    const result = startDirectPty({
      id: 'claude-main-wsl-test-4',
      providerId: 'claude',
      cwd: '\\\\wsl$\\Ubuntu\\home\\user\\project',
    });

    expect(result).toBeNull();
  });

  it('handles wsl.localhost paths the same as wsl$ paths', async () => {
    const { computePtySpawnConfig } = await import('../../main/services/ptyManager');

    const result = computePtySpawnConfig({
      id: 'claude-main-wsl-test-5',
      cwd: '\\\\wsl.localhost\\Debian\\home\\dev\\app',
      shell: 'claude',
    });

    expect(result.command).toBe('wsl.exe');
    expect(result.args[1]).toBe('Debian');
    expect(result.args[3]).toBe('/home/dev/app');
  });

  it('uses auto-approve flag inside WSL chain command', async () => {
    const { computePtySpawnConfig } = await import('../../main/services/ptyManager');

    const result = computePtySpawnConfig({
      id: 'claude-main-wsl-test-6',
      cwd: '\\\\wsl$\\Ubuntu\\home\\user\\project',
      shell: 'claude',
      autoApprove: true,
    });

    const chainCommand: string = result.args[7];
    expect(chainCommand).toContain('--dangerously-skip-permissions');
    expect(chainCommand).toMatch(/^claude\b/);
  });

  it('non-WSL Windows path does NOT route through wsl.exe', async () => {
    const { computePtySpawnConfig } = await import('../../main/services/ptyManager');

    const result = computePtySpawnConfig({
      id: 'shell-main-local-test',
      cwd: 'C:\\Users\\test\\project',
    });

    expect(result.command).not.toBe('wsl.exe');
    // On Windows without WSL, it should use the native shell
    expect(result.cwd).toBe('C:\\Users\\test\\project');
  });
});
