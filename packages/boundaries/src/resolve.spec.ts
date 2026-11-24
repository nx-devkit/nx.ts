import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { externalPackageName, loadTsPaths } from './resolve.ts';

describe('externalPackageName', () => {
  it('returns null for relative, absolute, and builtin specifiers', () => {
    expect(externalPackageName('./foo')).toBeNull();
    expect(externalPackageName('../foo/bar')).toBeNull();
    expect(externalPackageName('/abs/path')).toBeNull();
    expect(externalPackageName('node:fs')).toBeNull();
    expect(externalPackageName('bun:test')).toBeNull();
    expect(externalPackageName('fs')).toBeNull();
    // Subpaths of builtins are not package deps either.
    expect(externalPackageName('path/posix')).toBeNull();
    expect(externalPackageName('fs/promises')).toBeNull();
  });

  it('extracts the package name from bare specifiers', () => {
    expect(externalPackageName('lodash')).toBe('lodash');
    expect(externalPackageName('lodash/fp')).toBe('lodash');
    expect(externalPackageName('@angular/core')).toBe('@angular/core');
    expect(externalPackageName('@angular/core/testing')).toBe('@angular/core');
  });
});

describe('loadTsPaths', () => {
  it('an explicit empty paths object disables tsconfig.base.json aliases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nxdevkit-paths-'));
    try {
      writeFileSync(
        join(dir, 'tsconfig.base.json'),
        JSON.stringify({ compilerOptions: { paths: { '@acme/*': ['libs/*'] } } }),
      );
      // `paths: {}` replaces the base's paths wholesale (TS extends semantics).
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: {} } }));
      expect(loadTsPaths(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
