import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandMembers, joinRel } from './workspace.ts';

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-cargo-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const MANIFEST = '[package]\nname = "x"\n';

describe('expandMembers', () => {
  it('expands glob members and keeps sorted output', () => {
    const root = makeWorkspace({
      'crates/b/Cargo.toml': MANIFEST,
      'crates/a/Cargo.toml': MANIFEST,
      'crates/a/src/lib.rs': '',
      'tools/gen/Cargo.toml': MANIFEST,
    });
    expect(expandMembers(root, '', ['crates/*'], [], false)).toEqual(['crates/a', 'crates/b']);
  });

  it('accepts literal member paths', () => {
    const root = makeWorkspace({
      'libs/one/Cargo.toml': MANIFEST,
      'libs/two/Cargo.toml': MANIFEST,
    });
    expect(expandMembers(root, '', ['libs/one'], [], false)).toEqual(['libs/one']);
  });

  it('subtracts exclude globs', () => {
    const root = makeWorkspace({
      'crates/a/Cargo.toml': MANIFEST,
      'crates/skip/Cargo.toml': MANIFEST,
    });
    expect(expandMembers(root, '', ['crates/*'], ['crates/skip'], false)).toEqual(['crates/a']);
  });

  it('folds in the root package as an implicit member', () => {
    const root = makeWorkspace({
      'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n[package]\nname = "root"\n',
      'crates/a/Cargo.toml': MANIFEST,
    });
    const members = expandMembers(root, '', ['crates/*'], [], true);
    expect(members).toEqual(['', 'crates/a']);
  });

  it('expands members relative to a nested workspace root', () => {
    const root = makeWorkspace({
      'rust/crates/a/Cargo.toml': MANIFEST,
      'rust/crates/b/Cargo.toml': MANIFEST,
      'other/Cargo.toml': MANIFEST,
    });
    expect(expandMembers(root, 'rust', ['crates/*'], [], false)).toEqual([
      'rust/crates/a',
      'rust/crates/b',
    ]);
  });

  it('never descends into target or node_modules dirs', () => {
    const root = makeWorkspace({
      'target/debug/build/Cargo.toml': MANIFEST,
      'node_modules/x/Cargo.toml': MANIFEST,
      'crates/a/Cargo.toml': MANIFEST,
    });
    expect(expandMembers(root, '', ['**'], [], false)).toEqual(['crates/a']);
  });
});

describe('joinRel', () => {
  it('joins relative paths', () => {
    expect(joinRel('crates/a', '../b')).toBe('crates/b');
    expect(joinRel('', 'crates/a')).toBe('crates/a');
    expect(joinRel('crates/a', '.')).toBe('crates/a');
    expect(joinRel('a/b', '../../c')).toBe('c');
  });

  it('marks escapes above the workspace root', () => {
    expect(joinRel('crates/a', '../../x')).toBe('x');
    expect(joinRel('', '../x')).toBe('..');
    expect(joinRel('a', '../../../x')).toBe('..');
  });
});
