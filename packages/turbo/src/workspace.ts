import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { minimatch } from 'minimatch';
import { logDebug, parseJsonObject } from '@nx-devkit/internal';

const PLUGIN_SCOPE = 'nx-devkit/turbo';

/** A workspace package discovered on disk. */
export interface WorkspacePackage {
  /** The `name` field of the package's package.json — also the Nx project name. */
  name: string | undefined;
  /** Workspace-relative project root (`packages/app`). Never the workspace root itself. */
  root: string;
  /** The `scripts` map of the package's package.json. */
  scripts: Record<string, string>;
}

/**
 * The workspace globs a package manager would use, in precedence order:
 * `workspaces` in the root package.json (npm / yarn / bun, array or
 * `{ packages }` form) → `packages:` in `pnpm-workspace.yaml` →
 * `packages` in `lerna.json` → the `packages/*` + `apps/*` convention.
 */
export function readWorkspacePatterns(workspaceRoot: string): string[] {
  const pkg = readPackageJson(join(workspaceRoot, 'package.json'));
  const workspaces = pkg?.workspaces;
  const fromPkg = Array.isArray(workspaces)
    ? workspaces
    : isRecord(workspaces) && Array.isArray(workspaces.packages)
      ? workspaces.packages
      : null;
  // An explicit `workspaces` declaration wins even when empty.
  if (fromPkg !== null) return stringOnly(fromPkg);

  const pnpmPatterns = readPnpmWorkspace(join(workspaceRoot, 'pnpm-workspace.yaml'));
  // An explicit `packages:` declaration wins even when empty — `packages: []`
  // means no workspace packages, not "fall through to the next source".
  if (pnpmPatterns !== null) return pnpmPatterns;

  const lerna = readPackageJson(join(workspaceRoot, 'lerna.json'));
  if (lerna !== null && Array.isArray(lerna.packages)) {
    return stringOnly(lerna.packages);
  }

  logDebug(PLUGIN_SCOPE, 'No workspace declaration found — falling back to packages/* and apps/*');
  return ['packages/*', 'apps/*'];
}

/**
 * Every workspace package dir matched by the workspace globs, sorted by
 * root. Only directories containing a `package.json` count — matching npm
 * semantics, where a glob match without a manifest is not a package.
 */
export function discoverWorkspacePackages(workspaceRoot: string): WorkspacePackage[] {
  const dirs = expandWorkspaceGlobs(workspaceRoot, readWorkspacePatterns(workspaceRoot));
  const packages: WorkspacePackage[] = [];
  for (const dir of dirs) {
    const pkg = readPackageJson(join(workspaceRoot, dir, 'package.json'));
    if (!pkg) continue;
    packages.push({
      name: typeof pkg.name === 'string' && pkg.name !== '' ? pkg.name : undefined,
      root: dir,
      scripts: stringMap(pkg.scripts),
    });
  }
  return packages;
}

/**
 * Directories matched by workspace glob patterns. `*` and `?` match
 * inside a segment, `**` matches any depth, a leading `!` excludes.
 * `node_modules` and hidden directories are never descended into.
 */
export function expandWorkspaceGlobs(workspaceRoot: string, patterns: string[]): string[] {
  const includes = patterns.filter((p) => !p.startsWith('!'));
  const excludes = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
  // All-negation pattern lists have no positive match rule — include every
  // walked dir not excluded. An entirely empty list stays empty (an explicit
  // `workspaces: []` means "no packages").
  const includeAll = includes.length === 0 && excludes.length > 0;
  const absRoot = resolve(workspaceRoot);
  const candidates = new Set<string>();
  // Each include pattern is walked from its literal leading path — a dir
  // outside that subtree can never match, so `packages/*` never scans the
  // rest of the workspace.
  const seeds = includeAll ? [''] : [...new Set(includes.map(literalSeed))];
  for (const seed of seeds) {
    const absSeed = seed === '' ? absRoot : join(absRoot, seed);
    if (!existsSync(absSeed)) continue;
    // The seed dir itself can match a literal pattern like `packages/app`.
    if (seed !== '') candidates.add(seed);
    for (const dir of walkPackageDirs(absSeed, seed)) {
      candidates.add(dir);
    }
  }
  return [...candidates]
    .filter(
      (dir) =>
        (includeAll || includes.some((g) => minimatch(dir, g, { dot: true }))) &&
        !excludes.some((g) => minimatch(dir, g, { dot: true })),
    )
    .sort();
}

/**
 * The literal leading path of a glob — `packages/*` seeds at `packages`;
 * a glob with no literal prefix seeds at the workspace root. A match can
 * only live inside the seed subtree, so the walk starts there instead of
 * scanning everything.
 */
function literalSeed(pattern: string): string {
  const segments: string[] = [];
  for (const segment of pattern.split('/')) {
    if (segment === '' || /[*?[\]{}()+!@]/.test(segment)) break;
    segments.push(segment);
  }
  return segments.join('/');
}

/**
 * Config paths ordered so the root config comes first and nested configs
 * follow — depth first, then lexical. The order decides merge precedence:
 * a package-level turbo.json is emitted after the root one and therefore
 * wins for the same target name.
 */
export function sortPathsByDepth(paths: readonly string[]): string[] {
  return [...paths].sort((a, b) => {
    const da = a.split('/').length;
    const db = b.split('/').length;
    return da !== db ? da - db : a.localeCompare(b);
  });
}

/** Every directory under `relDir` that contains a package.json. */
function* walkPackageDirs(absDir: string, relDir: string): Generator<string> {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    // node_modules never holds workspace packages; hidden dirs (.git,
    // .nx, .turbo) are not workspace containers either.
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const absChild = join(absDir, name);
    const relChild = relDir === '' ? name : `${relDir}/${name}`;
    if (existsSync(join(absChild, 'package.json'))) {
      yield relChild;
    }
    yield* walkPackageDirs(absChild, relChild);
  }
}

/**
 * The `packages:` list of a pnpm-workspace.yaml, parsed without a YAML
 * dependency — the key is always a top-level list of quoted or bare
 * strings in practice. Returns `null` when no `packages:` declaration
 * exists; an explicit empty list returns `[]` (no workspace packages).
 */
function readPnpmWorkspace(path: string): string[] | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const out: string[] = [];
  let inPackages = false;
  let declared = false;
  for (const rawLine of text.split(/\r?\n/)) {
    // `#` opens a comment at line start or after whitespace.
    const line = rawLine.replace(/(^|\s)#.*$/, '');
    if (line.trim() === '') continue;
    // A `- item` line inside the packages block (indent is optional in
    // YAML block lists).
    const item = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (item !== null && inPackages && item[1] !== undefined) {
      out.push(unquote(item[1]));
      continue;
    }
    // Any other top-level key ends the packages block.
    if (/^\S/.test(line)) {
      inPackages = /^packages\s*:/.test(line);
      if (inPackages) declared = true;
      // Inline form: packages: ['a/*', 'b/*']
      const inline = /^packages\s*:\s*\[(.*)\]\s*$/.exec(line);
      if (inline?.[1] !== undefined) {
        for (const entry of splitInlineList(inline[1])) {
          const value = unquote(entry.trim());
          if (value !== '') out.push(value);
        }
      }
    }
  }
  return declared ? out : null;
}

/**
 * Split an inline `[a, b]` list on commas — a comma inside `{}`/`[]`
 * (brace globs) or inside quotes does not separate items.
 */
function splitInlineList(text: string): string[] {
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (const char of text) {
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{' || char === '[') {
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
    }
    if (char === ',' && depth === 0 && quote === null) {
      items.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  items.push(current);
  return items;
}

function unquote(value: string): string {
  const m = /^(['"])(.*)\1$/.exec(value);
  return m?.[2] ?? value;
}

/** A parsed package.json, or null when the file is missing or invalid. */
export function readPackageJson(path: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseJsonObject(text, path);
  } catch {
    logDebug(PLUGIN_SCOPE, `Could not parse ${path}`);
    return null;
  }
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function stringOnly(value: unknown[]): string[] {
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
