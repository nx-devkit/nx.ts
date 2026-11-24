import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '@nx/devkit';
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodesV2, PYPROJECT_GLOB } from './plugin.ts';
import type { NxDevkitPythonOptions } from './types.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

const tempRoots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-python-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function infer(
  root: string,
  files: string[],
  options: NxDevkitPythonOptions = {},
): Array<readonly [string, { projects: Record<string, { targets?: Record<string, unknown> }> }]> {
  return createNodesV2[1](files, options, makeContext(root)) as Array<
    readonly [string, { projects: Record<string, { targets?: Record<string, unknown> }> }]
  >;
}

const PYTEST = `[project]\nname = "app"\ndependencies = ["pytest>=8"]\n`;
const RUFF = `[tool.ruff]\nline-length = 100\n`;
const UV = `[tool.uv]\n`;
const POETRY = `[tool.poetry]\nname = "app"\n`;

describe('@nx-devkit/python createNodesV2', () => {
  it('triggers on pyproject.toml files', () => {
    expect(PYPROJECT_GLOB).toBe('**/pyproject.toml');
    expect(createNodesV2[0]).toBe(PYPROJECT_GLOB);
  });

  it('infers test when pytest is a project dependency', async () => {
    const root = makeWorkspace({ 'services/api/pyproject.toml': PYTEST });
    const results = await infer(root, ['services/api/pyproject.toml']);

    const project = results[0]![1].projects['services/api']!;
    const test = project.targets!['test']! as {
      executor: string;
      cache: boolean;
      options: Record<string, unknown>;
    };
    expect(test.executor).toBe('nx:run-commands');
    expect(test.options).toEqual({ command: 'pytest', cwd: '{projectRoot}' });
    expect(test.cache).toBe(true);
  });

  it('infers test when a [tool.pytest.*] table exists even without the dep', async () => {
    const root = makeWorkspace({
      'pkg/pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n',
    });
    const results = await infer(root, ['pkg/pyproject.toml']);

    const test = results[0]![1].projects['pkg']!.targets!['test']! as {
      options: Record<string, unknown>;
    };
    expect(test.options).toEqual({ command: 'pytest', cwd: '{projectRoot}' });
  });

  it('infers lint + fmt when [tool.ruff] is present', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': RUFF });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const targets = results[0]![1].projects['pkg']!.targets! as Record<
      string,
      { options: { command: string }; cache: boolean }
    >;

    expect(targets['lint']!.options.command).toBe('ruff check');
    expect(targets['fmt']!.options.command).toBe('ruff format --check');
    expect(targets['lint']!.cache).toBe(true);
    expect(targets['fmt']!.cache).toBe(true);
  });

  it('infers lint + fmt when ruff is in a dependency group', async () => {
    const root = makeWorkspace({
      'pkg/pyproject.toml': '[dependency-groups]\ndev = ["ruff>=0.9"]\n',
    });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const targets = results[0]![1].projects['pkg']!.targets!;

    expect(targets['lint']).toBeDefined();
    expect(targets['fmt']).toBeDefined();
  });

  it('infers typecheck `ty check` when ty is configured', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': '[tool.ty.rules]\n' });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const typecheck = results[0]![1].projects['pkg']!.targets!['typecheck']! as {
      options: { command: string };
    };
    expect(typecheck.options.command).toBe('ty check');
  });

  it('falls back to pyright when only [tool.pyright] is configured', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': '[tool.pyright]\nstrict = true\n' });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const typecheck = results[0]![1].projects['pkg']!.targets!['typecheck']! as {
      options: { command: string };
    };
    expect(typecheck.options.command).toBe('pyright');
  });

  it('prefers ty over pyright when both are configured', async () => {
    const root = makeWorkspace({
      'pkg/pyproject.toml': '[tool.ty]\n\n[tool.pyright]\n',
    });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const typecheck = results[0]![1].projects['pkg']!.targets!['typecheck']! as {
      options: { command: string };
    };
    expect(typecheck.options.command).toBe('ty check');
  });

  it('prefixes commands with `uv run` and adds `uv lock --check` when [tool.uv] is present', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': UV + PYTEST });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const targets = results[0]![1].projects['pkg']!.targets! as Record<
      string,
      { options: { command: string }; cache: boolean }
    >;

    expect(targets['test']!.options.command).toBe('uv run pytest');
    expect(targets['lock']!.options.command).toBe('uv lock --check');
    expect(targets['lock']!.cache).toBe(true);
  });

  it('uses `uv run` when only uv.lock exists (no [tool.uv] table)', async () => {
    const root = makeWorkspace({
      'pkg/pyproject.toml': PYTEST,
      'pkg/uv.lock': 'version = 1\n',
    });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const targets = results[0]![1].projects['pkg']!.targets! as Record<
      string,
      { options: { command: string } }
    >;

    expect(targets['test']!.options.command).toBe('uv run pytest');
    expect(targets['lock']!.options.command).toBe('uv lock --check');
  });

  it('detects a workspace-root uv.lock for a nested project', async () => {
    const root = makeWorkspace({
      'pyproject.toml': UV,
      'uv.lock': 'version = 1\n',
      'packages/lib/pyproject.toml': PYTEST,
    });
    const results = await infer(root, ['packages/lib/pyproject.toml']);
    const test = results[0]![1].projects['packages/lib']!.targets!['test']! as {
      options: { command: string };
      inputs: string[];
    };
    expect(test.options.command).toBe('uv run pytest');
    expect(test.inputs).toContain('{projectRoot}/uv.lock');
    expect(test.inputs).toContain('{workspaceRoot}/uv.lock');
  });

  it('prefixes commands with `poetry run` and adds `poetry check` when [tool.poetry] is present', async () => {
    const root = makeWorkspace({
      'pkg/pyproject.toml': `${POETRY}[tool.poetry.dev-dependencies]\npytest = "^8"\n`,
    });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const targets = results[0]![1].projects['pkg']!.targets! as Record<
      string,
      { options: { command: string }; inputs: string[] }
    >;

    expect(targets['test']!.options.command).toBe('poetry run pytest');
    expect(targets['lock']!.options.command).toBe('poetry check');
    expect(targets['lock']!.inputs).toContain('{projectRoot}/poetry.lock');
  });

  it('reads poetry group dependencies', async () => {
    const root = makeWorkspace({
      'pkg/pyproject.toml': `${POETRY}[tool.poetry.group.lint.dependencies]\nruff = "^0.9"\n`,
    });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const targets = results[0]![1].projects['pkg']!.targets!;
    expect(targets['lint']).toBeDefined();
    expect(targets['fmt']).toBeDefined();
  });

  it('runs plain commands with no runner prefix when no manager is declared', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': PYTEST + RUFF });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const targets = results[0]![1].projects['pkg']!.targets! as Record<
      string,
      { options: { command: string } }
    >;

    expect(targets['test']!.options.command).toBe('pytest');
    expect(targets['lint']!.options.command).toBe('ruff check');
    expect(targets['lock']).toBeUndefined();
  });

  it('covers pyproject.toml, the lock file, python sources, and pytest config in inputs', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': UV + PYTEST });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const test = results[0]![1].projects['pkg']!.targets!['test']! as { inputs: string[] };

    expect(test.inputs).toEqual(
      expect.arrayContaining([
        '{projectRoot}/pyproject.toml',
        '{projectRoot}/**/*.py',
        '{projectRoot}/pytest.ini',
        '{projectRoot}/tox.ini',
        '{projectRoot}/setup.cfg',
        '{projectRoot}/**/conftest.py',
        '{projectRoot}/**/ruff.toml',
        '{projectRoot}/**/.ruff.toml',
        '{projectRoot}/**/pyrightconfig.json',
        '{projectRoot}/**/ty.toml',
        '{projectRoot}/uv.lock',
      ]),
    );
  });

  it('keeps the lock target inputs to the manifest and the lock file', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': UV });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const lock = results[0]![1].projects['pkg']!.targets!['lock']! as { inputs: string[] };

    expect(lock.inputs).toEqual(['{projectRoot}/pyproject.toml', '{projectRoot}/uv.lock']);
  });

  it('scopes pytest away from nested project roots so run-many does not double-collect', async () => {
    const root = makeWorkspace({
      'app/pyproject.toml': PYTEST,
      'app/lib/pyproject.toml': PYTEST,
      'app/lib/deep/pyproject.toml': PYTEST,
    });
    const results = await infer(root, [
      'app/pyproject.toml',
      'app/lib/pyproject.toml',
      'app/lib/deep/pyproject.toml',
    ]);

    const byFile = new Map(results.map(([f, r]) => [f, r]));
    const app = byFile.get('app/pyproject.toml')!.projects['app']!.targets!['test']! as {
      options: { command: string };
    };
    const lib = byFile.get('app/lib/pyproject.toml')!.projects['app/lib']!.targets!['test']! as {
      options: { command: string };
    };
    const deep = byFile.get('app/lib/deep/pyproject.toml')!.projects['app/lib/deep']!.targets![
      'test'
    ]! as { options: { command: string } };

    expect(app.options.command).toBe(`pytest --ignore='lib' --ignore='lib/deep'`);
    expect(lib.options.command).toBe(`pytest --ignore='deep'`);
    expect(deep.options.command).toBe('pytest');
  });

  it('infers targets on the root project for a workspace-root pyproject.toml', async () => {
    const root = makeWorkspace({ 'pyproject.toml': UV + PYTEST });
    const results = await infer(root, ['pyproject.toml']);

    const targets = results[0]![1].projects['']!.targets!;
    expect(targets['test']).toBeDefined();
  });

  it('infers nothing but the project itself when no known tool is declared', async () => {
    const root = makeWorkspace({
      'pkg/pyproject.toml': '[project]\nname = "lib"\n',
    });
    const results = await infer(root, ['pkg/pyproject.toml']);

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects['pkg']!.targets ?? {};
    expect(Object.keys(targets)).toHaveLength(0);
  });

  it('option test:false drops the test target only', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': PYTEST + RUFF });
    const results = await infer(root, ['pkg/pyproject.toml'], { test: false });
    const targets = results[0]![1].projects['pkg']!.targets!;

    expect(targets['test']).toBeUndefined();
    expect(targets['lint']).toBeDefined();
  });

  it('option lint:false drops lint and fmt', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': RUFF });
    const results = await infer(root, ['pkg/pyproject.toml'], { lint: false });
    const targets = results[0]![1].projects['pkg']!.targets!;

    expect(targets['lint']).toBeUndefined();
    expect(targets['fmt']).toBeUndefined();
  });

  it('option typecheck:false drops the typecheck target', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': '[tool.ty]\n' });
    const results = await infer(root, ['pkg/pyproject.toml'], { typecheck: false });
    const targets = results[0]![1].projects['pkg']!.targets!;

    expect(targets['typecheck']).toBeUndefined();
  });

  it('option lock:false drops the lock target', async () => {
    const root = makeWorkspace({ 'pkg/pyproject.toml': UV + PYTEST });
    const results = await infer(root, ['pkg/pyproject.toml'], { lock: false });
    const targets = results[0]![1].projects['pkg']!.targets!;

    expect(targets['lock']).toBeUndefined();
    expect(targets['test']).toBeDefined();
  });

  it('skips pyproject.toml inside node_modules and outside the workspace', async () => {
    const root = makeWorkspace({
      'node_modules/x/pyproject.toml': PYTEST,
    });
    const results = await infer(root, [
      'node_modules/x/pyproject.toml',
      '../outside/pyproject.toml',
    ]);
    expect(results).toHaveLength(0);
  });

  it('warns and skips an unparseable pyproject.toml without breaking the graph', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const root = makeWorkspace({
      'bad/pyproject.toml': '[tool.ruff\ninvalid',
      'good/pyproject.toml': PYTEST,
    });
    const results = await infer(root, ['bad/pyproject.toml', 'good/pyproject.toml']);

    expect(results).toHaveLength(1);
    expect(results[0]![1].projects['good']).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad/pyproject.toml'));
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/pyproject.toml': PYTEST,
      'b/pyproject.toml': RUFF,
    });
    const fwd = await infer(root, ['a/pyproject.toml', 'b/pyproject.toml']);
    const rev = await infer(root, ['b/pyproject.toml', 'a/pyproject.toml']);
    expect(fwd).toEqual(rev);
  });

  it('normalizes PEP 508 specs — extras, markers, and case differences still detect the tool', async () => {
    const root = makeWorkspace({
      'pkg/pyproject.toml':
        '[project]\nname="a"\ndependencies = ["PyTest[cov]>=8 ; python_version>\'3.9\'", "Ruff"]\n',
    });
    const results = await infer(root, ['pkg/pyproject.toml']);
    const targets = results[0]![1].projects['pkg']!.targets!;

    expect(targets['test']).toBeDefined();
    expect(targets['lint']).toBeDefined();
  });
});
