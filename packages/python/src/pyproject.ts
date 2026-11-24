import { parse } from 'smol-toml';

/**
 * Which Python tools a pyproject.toml declares — each boolean means "the
 * file configures or depends on the tool", so inference never invents a
 * target for a tool the project does not use.
 */
export interface PyTools {
  /** `[tool.pytest.*]` table or `pytest` in any dependency list. */
  pytest: boolean;
  /** `[tool.ruff]` table or `ruff` in any dependency list. */
  ruff: boolean;
  /** `[tool.ty]` table or `ty` in any dependency list. */
  ty: boolean;
  /** `[tool.pyright]` table or `pyright` in any dependency list. */
  pyright: boolean;
  /** `[tool.uv]` table — uv-managed project. */
  uv: boolean;
  /** `[tool.poetry]` table — poetry-managed project. */
  poetry: boolean;
}

/** The command runner a project uses to reach its own environment. */
export type PyRunner = 'uv' | 'poetry' | 'plain';

/**
 * Parse a pyproject.toml. Throws on malformed TOML — the caller decides
 * whether a broken file should break the graph (it must not).
 */
export function parsePyProject(text: string): Record<string, unknown> {
  return parse(text) as Record<string, unknown>;
}

/**
 * Detect every supported tool declared in a pyproject.toml. A tool counts
 * as declared when it has a `[tool.<name>]` table or appears in any
 * dependency list the file carries — `[project.dependencies]`,
 * `[project.optional-dependencies.*]`, `[dependency-groups.*]`,
 * `[tool.uv.dev-dependencies]`, and every poetry dependency table.
 */
export function detectTools(doc: Record<string, unknown>): PyTools {
  const tool = isRecord(doc['tool']) ? doc['tool'] : undefined;
  const deps = declaredDependencies(doc);
  return {
    pytest: hasTable(tool, 'pytest') || deps.has('pytest'),
    ruff: hasTable(tool, 'ruff') || deps.has('ruff'),
    ty: hasTable(tool, 'ty') || deps.has('ty'),
    pyright: hasTable(tool, 'pyright') || deps.has('pyright'),
    uv: hasTable(tool, 'uv'),
    poetry: hasTable(tool, 'poetry'),
  };
}

/**
 * Pick the command runner: uv when `[tool.uv]` or a `uv.lock` is around,
 * poetry when `[tool.poetry]` declares it, otherwise the tools run plain
 * (assuming they are on PATH).
 */
export function detectRunner(tools: PyTools, hasUvLock: boolean): PyRunner {
  if (tools.uv || hasUvLock) return 'uv';
  if (tools.poetry) return 'poetry';
  return 'plain';
}

/** The shell prefix a runner adds to tool invocations. */
export function runnerPrefix(runner: PyRunner): string {
  if (runner === 'uv') return 'uv run ';
  if (runner === 'poetry') return 'poetry run ';
  return '';
}

/**
 * Every dependency name the file declares, normalized per PEP 503
 * (lowercase, runs of `-`/`_`/`.` folded to `-`) so `PyTest[cov]` and
 * `pytest` compare equal.
 */
export function declaredDependencies(doc: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const addSpec = (spec: unknown): void => {
    if (typeof spec !== 'string') return;
    const name = depName(spec);
    if (name !== null) names.add(name);
  };
  const addArray = (value: unknown): void => {
    if (Array.isArray(value)) for (const entry of value) addSpec(entry);
  };
  const addKeys = (value: unknown): void => {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
      const name = normalizeName(key);
      // `python` in a poetry dependency table is the interpreter pin, not a package.
      if (name !== 'python') names.add(name);
    }
  };

  const project = isRecord(doc['project']) ? doc['project'] : undefined;
  addArray(project?.['dependencies']);
  const optionalDeps = isRecord(project?.['optional-dependencies'])
    ? project['optional-dependencies']
    : undefined;
  for (const entry of Object.values(optionalDeps ?? {})) addArray(entry);

  const groups = isRecord(doc['dependency-groups']) ? doc['dependency-groups'] : undefined;
  for (const entry of Object.values(groups ?? {})) addArray(entry);

  const tool = isRecord(doc['tool']) ? doc['tool'] : undefined;
  const poetry = isRecord(tool?.['poetry']) ? tool['poetry'] : undefined;
  addKeys(poetry?.['dependencies']);
  addKeys(poetry?.['dev-dependencies']);
  const poetryGroups = isRecord(poetry?.['group']) ? poetry['group'] : undefined;
  for (const group of Object.values(poetryGroups ?? {})) {
    addKeys(isRecord(group) ? group['dependencies'] : undefined);
  }

  const uv = isRecord(tool?.['uv']) ? tool['uv'] : undefined;
  addArray(uv?.['dev-dependencies']);

  return names;
}

/**
 * Package name out of a PEP 508 spec (`name[extras] op version ; marker`)
 * or a poetry-style constraint; returns null when no name leads.
 */
function depName(spec: string): string | null {
  const match = /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(spec.trim());
  if (match === null) return null;
  return normalizeName(match[0]);
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function hasTable(tool: Record<string, unknown> | undefined, name: string): boolean {
  return isRecord(tool?.[name]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
