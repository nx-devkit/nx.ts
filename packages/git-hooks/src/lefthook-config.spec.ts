import { describe, expect, it } from 'vitest';
import { parseLefthookConfig } from './lefthook-config.ts';

describe('parseLefthookConfig', () => {
  it('extracts hook names from top-level mapping sections', () => {
    const text = `
pre-commit:
  parallel: true
  commands:
    lint:
      run: npx eslint {staged_files}
commit-msg:
  commands:
    commitlint:
      run: npx commitlint --edit
`;
    const result = parseLefthookConfig(text);
    expect(result.hooks).toEqual(['commit-msg', 'pre-commit']);
    expect(result.skipped).toEqual([]);
  });

  it('returns hooks sorted for deterministic output', () => {
    const result = parseLefthookConfig(`
pre-push:
  commands:
    test:
      run: npm test
post-merge:
  commands:
    install:
      run: npm install
pre-commit:
  jobs:
    - run: npm run lint
`);
    expect(result.hooks).toEqual(['post-merge', 'pre-commit', 'pre-push']);
  });

  it('excludes lefthook setting keys — they are not hooks', () => {
    const result = parseLefthookConfig(`
min_version: 1.5.0
extends:
  - base.yml
skip_output:
  - meta
source_dir: custom
source_dir_local: custom_local
colors: false
no_tty: true
assert_lefthook_installed: true
rc: .lefthookrc
output:
  - meta
remote:
  git_url: git@example.com:repo.git
  refetch: true
remotes:
  - origin
execution: parallel
templates:
  lint: npx eslint .
glob_matcher: regexp
install_non_git_hooks: true
no_auto_install: true
skip_lfs: true
ai: {}
lefthook: {}
pre-commit:
  commands:
    lint:
      run: npx eslint .
`);
    expect(result.hooks).toEqual(['pre-commit']);
    expect(result.skipped).toEqual([]);
  });

  it('keeps custom hook names — lefthook run accepts user-defined sections', () => {
    const result = parseLefthookConfig(`
db-seed:
  commands:
    seed:
      run: npm run seed
`);
    expect(result.hooks).toEqual(['db-seed']);
  });

  it('reports scalar-valued non-setting keys as skipped', () => {
    const result = parseLefthookConfig(`
pre-commit: true
weird-section: just a string
pre-push:
  commands:
    test:
      run: npm test
`);
    expect(result.hooks).toEqual(['pre-push']);
    expect(result.skipped).toEqual(['pre-commit', 'weird-section']);
  });

  it('reports hook names that are unsafe for a shell command as skipped', () => {
    const result = parseLefthookConfig(`
'pre-commit; rm -rf /':
  commands:
    x:
      run: y
'has space':
  commands:
    x:
      run: y
pre-commit:
  commands:
    x:
      run: y
`);
    expect(result.hooks).toEqual(['pre-commit']);
    expect(result.skipped).toEqual(['has space', 'pre-commit; rm -rf /']);
  });

  it('returns empty sets for non-mapping documents', () => {
    expect(parseLefthookConfig('- just\n- a\n- list\n')).toEqual({ hooks: [], skipped: [] });
    expect(parseLefthookConfig('a scalar string\n')).toEqual({ hooks: [], skipped: [] });
    expect(parseLefthookConfig('')).toEqual({ hooks: [], skipped: [] });
  });

  it('treats empty hook sections as skipped — nothing to run', () => {
    const result = parseLefthookConfig(`
pre-commit:
pre-push:
  commands:
    test:
      run: npm test
`);
    expect(result.hooks).toEqual(['pre-push']);
    expect(result.skipped).toEqual(['pre-commit']);
  });

  it('throws on malformed YAML', () => {
    expect(() => parseLefthookConfig('pre-commit:\n  commands: [unclosed\n')).toThrow();
  });
});
