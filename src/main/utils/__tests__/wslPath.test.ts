import { describe, it, expect } from 'vitest';
import { isWslPath, getWslDistro, toWslPosixPath, toWindowsUncPath } from '../wslPath';

describe('isWslPath', () => {
  it('detects \\\\wsl$\\Distro paths', () => {
    expect(isWslPath('\\\\wsl$\\Ubuntu\\home\\user')).toBe(true);
  });

  it('detects \\\\wsl.localhost\\Distro paths', () => {
    expect(isWslPath('\\\\wsl.localhost\\Ubuntu\\home\\user')).toBe(true);
  });

  it('detects forward-slash variants', () => {
    expect(isWslPath('//wsl$/Ubuntu/home/user')).toBe(true);
    expect(isWslPath('//wsl.localhost/Ubuntu/home/user')).toBe(true);
  });

  it('is case-insensitive on the prefix', () => {
    expect(isWslPath('\\\\WSL$\\Ubuntu\\home')).toBe(true);
    expect(isWslPath('\\\\WSL.LOCALHOST\\Ubuntu\\home')).toBe(true);
  });

  it('rejects non-WSL paths', () => {
    expect(isWslPath('C:\\Users\\user\\projects')).toBe(false);
    expect(isWslPath('/home/user/projects')).toBe(false);
    expect(isWslPath('\\\\server\\share')).toBe(false);
    expect(isWslPath('')).toBe(false);
  });
});

describe('getWslDistro', () => {
  it('extracts distro from wsl$ path', () => {
    expect(getWslDistro('\\\\wsl$\\Ubuntu\\home\\user')).toBe('Ubuntu');
  });

  it('extracts distro from wsl.localhost path', () => {
    expect(getWslDistro('\\\\wsl.localhost\\Debian\\tmp')).toBe('Debian');
  });

  it('returns null for non-WSL paths', () => {
    expect(getWslDistro('C:\\Windows')).toBeNull();
    expect(getWslDistro('')).toBeNull();
  });
});

describe('toWslPosixPath', () => {
  it('converts basic UNC path', () => {
    expect(toWslPosixPath('\\\\wsl$\\Ubuntu\\home\\user\\project')).toBe('/home/user/project');
  });

  it('handles root path', () => {
    expect(toWslPosixPath('\\\\wsl$\\Ubuntu')).toBe('/');
    expect(toWslPosixPath('\\\\wsl$\\Ubuntu\\')).toBe('/');
  });

  it('handles wsl.localhost variant', () => {
    expect(toWslPosixPath('\\\\wsl.localhost\\Ubuntu\\tmp')).toBe('/tmp');
  });

  it('handles forward-slash input', () => {
    expect(toWslPosixPath('//wsl$/Ubuntu/home/user')).toBe('/home/user');
  });

  it('throws for non-WSL paths', () => {
    expect(() => toWslPosixPath('C:\\Users\\user')).toThrow('Not a WSL UNC path');
  });
});

describe('toWindowsUncPath', () => {
  it('converts basic POSIX path', () => {
    expect(toWindowsUncPath('Ubuntu', '/home/user/project')).toBe(
      '\\\\wsl$\\Ubuntu\\home\\user\\project'
    );
  });

  it('converts root path', () => {
    expect(toWindowsUncPath('Ubuntu', '/')).toBe('\\\\wsl$\\Ubuntu\\');
  });

  it('round-trips with toWslPosixPath', () => {
    const original = '\\\\wsl$\\Ubuntu\\home\\user\\project';
    const distro = getWslDistro(original)!;
    const posix = toWslPosixPath(original);
    expect(toWindowsUncPath(distro, posix)).toBe(original);
  });
});
