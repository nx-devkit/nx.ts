import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildModuleTargets } from './targets.ts';

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-go-targets-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const ctx = (workspaceRoot: string, over: Record<string, unknown> = {}) => ({
  workspaceRoot,
  goWorkFile: null,
  lint: true,
  ...over,
});

describe('buildModuleTargets', () => {
  it('infers build, test and vet targets', () => {
    const root = makeWorkspace();
    const targets = buildModuleTargets('svc', ctx(root));

    expect(Object.keys(targets).sort()).toEqual(['build', 'test', 'vet']);
    expect(targets.build?.options).toMatchObject({
      command: 'go build ./...',
      cwd: '{projectRoot}',
    });
    expect(targets.test?.options).toMatchObject({ command: 'go test ./...', cwd: '{projectRoot}' });
    expect(targets.vet?.options).toMatchObject({ command: 'go vet ./...', cwd: '{projectRoot}' });
  });

  it('pins GOWORK to the claiming go.work; off for standalone modules', () => {
    const root = makeWorkspace();
    const member = buildModuleTargets('svc', ctx(root, { goWorkFile: 'tools/go.work' }));
    const standalone = buildModuleTargets('svc', ctx(root));

    expect(member.build?.options).toMatchObject({
      env: { GOWORK: join(root, 'tools/go.work') },
    });
    expect(standalone.build?.options).toMatchObject({ env: { GOWORK: 'off' } });
  });

  it('caches build, test and vet', () => {
    const root = makeWorkspace();
    const targets = buildModuleTargets('svc', ctx(root));

    expect(targets.build?.cache).toBe(true);
    expect(targets.test?.cache).toBe(true);
    expect(targets.vet?.cache).toBe(true);
    for (const t of Object.values(targets)) {
      expect(t.executor).toBe('nx:run-commands');
    }
  });

  it('hashes go.mod, go.sum and the whole module fileset minus tool dirs', () => {
    const root = makeWorkspace();
    const targets = buildModuleTargets('svc', ctx(root));
    const inputs = targets.build?.inputs ?? [];

    expect(inputs).toContain('{projectRoot}/go.mod');
    expect(inputs).toContain('{projectRoot}/go.sum');
    // `//go:embed` assets and CGo files need the whole tree, not just *.go.
    expect(inputs).toContain('{projectRoot}/**/*');
    expect(inputs).toContain('!{projectRoot}/**/vendor/**/*');
    expect(inputs).toContain('!{projectRoot}/**/node_modules/**/*');
    expect(inputs).toContain('!{projectRoot}/**/.git/**/*');
  });

  it('uses workspaceRoot-prefixed inputs for a module at the workspace root', () => {
    const root = makeWorkspace();
    const targets = buildModuleTargets('', ctx(root));
    const inputs = targets.build?.inputs ?? [];

    expect(inputs).toContain('{workspaceRoot}/go.mod');
    expect(inputs).toContain('{workspaceRoot}/go.sum');
    expect(inputs).toContain('{workspaceRoot}/**/*');
    expect(inputs).not.toContain('{projectRoot}/go.mod');
  });

  it('adds go.work and go.work.sum inputs for workspace members', () => {
    const root = makeWorkspace();
    const targets = buildModuleTargets('svc', ctx(root, { goWorkFile: 'go.work' }));
    const inputs = targets.build?.inputs ?? [];

    expect(inputs).toContain('{workspaceRoot}/go.work');
    expect(inputs).toContain('{workspaceRoot}/go.work.sum');
  });

  it('hashes sibling member sources for workspace members', () => {
    const root = makeWorkspace();
    const targets = buildModuleTargets(
      'svc',
      ctx(root, { goWorkFile: 'go.work', memberDirs: ['svc', 'lib'] }),
    );
    const inputs = targets.build?.inputs ?? [];

    expect(inputs).toContain('{workspaceRoot}/lib/go.mod');
    expect(inputs).toContain('{workspaceRoot}/lib/go.sum');
    expect(inputs).toContain('{workspaceRoot}/lib/**/*');
    expect(inputs).toContain('!{workspaceRoot}/lib/**/vendor/**/*');
    // The module itself stays on its {projectRoot} inputs.
    expect(inputs.filter((i) => typeof i === 'string' && i.includes('/svc/')).length).toBe(0);
  });

  it('places go.work.sum next to a nested go.work', () => {
    const root = makeWorkspace();
    const targets = buildModuleTargets('tools/svc', ctx(root, { goWorkFile: 'tools/go.work' }));
    const inputs = targets.build?.inputs ?? [];

    expect(inputs).toContain('{workspaceRoot}/tools/go.work');
    expect(inputs).toContain('{workspaceRoot}/tools/go.work.sum');
  });

  it('infers a lint target when .golangci.yml sits in the module dir', () => {
    const root = makeWorkspace({ 'svc/.golangci.yml': 'run: {}' });
    const targets = buildModuleTargets('svc', ctx(root));

    expect(targets.lint?.options).toMatchObject({
      command: 'golangci-lint run ./...',
      cwd: '{projectRoot}',
    });
    expect(targets.lint?.cache).toBe(true);
    expect(targets.lint?.inputs).toContain('{workspaceRoot}/svc/.golangci.yml');
  });

  it('accepts .golangci.yaml and .golangci.json', () => {
    const root = makeWorkspace({ 'a/.golangci.yaml': '', 'b/.golangci.json': '{}' });

    expect(buildModuleTargets('a', ctx(root)).lint).toBeDefined();
    expect(buildModuleTargets('b', ctx(root)).lint).toBeDefined();
    expect(buildModuleTargets('c', ctx(root)).lint).toBeUndefined();
  });

  it('falls back to a workspace-root .golangci config', () => {
    const root = makeWorkspace({ '.golangci.yml': 'run: {}' });
    const targets = buildModuleTargets('svc', ctx(root));

    expect(targets.lint?.options).toMatchObject({
      command: 'golangci-lint run ./...',
      cwd: '{projectRoot}',
    });
    expect(targets.lint?.inputs).toContain('{workspaceRoot}/.golangci.yml');
  });

  it('finds a golangci config in an intermediate ancestor dir', () => {
    const root = makeWorkspace({ 'pkgs/.golangci.yml': 'run: {}' });
    const targets = buildModuleTargets('pkgs/api', ctx(root));

    expect(targets.lint?.inputs).toContain('{workspaceRoot}/pkgs/.golangci.yml');
  });

  it('prefers the module-local golangci config over ancestor ones', () => {
    const root = makeWorkspace({
      '.golangci.yml': '',
      'pkgs/.golangci.yaml': '',
      'pkgs/api/.golangci.json': '{}',
    });
    const targets = buildModuleTargets('pkgs/api', ctx(root));

    expect(targets.lint?.inputs).toContain('{workspaceRoot}/pkgs/api/.golangci.json');
    expect(targets.lint?.inputs).not.toContain('{workspaceRoot}/.golangci.yml');
    expect(targets.lint?.inputs).not.toContain('{workspaceRoot}/pkgs/.golangci.yaml');
  });

  it('infers no lint target without a golangci config', () => {
    const root = makeWorkspace();
    expect(buildModuleTargets('svc', ctx(root)).lint).toBeUndefined();
  });

  it('honours lint: false', () => {
    const root = makeWorkspace({ 'svc/.golangci.yml': '' });
    expect(buildModuleTargets('svc', ctx(root, { lint: false })).lint).toBeUndefined();
  });

  it('supports a module at the workspace root', () => {
    const root = makeWorkspace({ '.golangci.yml': '' });
    const targets = buildModuleTargets('', ctx(root));

    expect(targets.build?.options).toMatchObject({
      command: 'go build ./...',
      cwd: '{projectRoot}',
    });
    expect(targets.lint?.inputs).toContain('{workspaceRoot}/.golangci.yml');
  });
});
