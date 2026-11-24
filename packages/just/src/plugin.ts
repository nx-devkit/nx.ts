import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  logger,
  type CreateNodesResultArray,
  type CreateNodesV2,
  type TargetConfiguration,
} from '@nx/devkit';
import { isVerbose, logDebug } from '@nx-devkit/internal';
import { parseJustfile, type JustAlias, type JustfileData, type JustRecipe } from './justfile.ts';
import type { NxDevkitJustOptions } from './types.ts';

const PLUGIN_SCOPE = 'nx-devkit/just';
const DEFAULT_TARGET_PREFIX = 'just:';
const MAX_MOD_DEPTH = 4;

/** Config files the plugin reacts to. */
export const JUSTFILE_GLOB =
  '**/{justfile,JUSTFILE,Justfile,.justfile,.Justfile,.JUSTFILE,just.just}';

interface ResolvedModule {
  /** Qualified module path, e.g. `tools` or `a::b`. */
  qualifiedName: string;
  /** Source path relative to the project root (the justfile's dir). */
  relPath: string;
  recipes: JustRecipe[];
  aliases: JustAlias[];
}

/** Search order just uses for `mod foo` without an explicit path. */
function defaultModPaths(dir: string, name: string): string[] {
  const bases = [
    `${name}.just`,
    `${name}.mod.just`,
    `${name}/mod.just`,
    `${name}/justfile`,
    `${name}/JUSTFILE`,
    `${name}/Justfile`,
    `${name}/.justfile`,
    `${name}/.JUSTFILE`,
    `${name}/.Justfile`,
  ];
  return bases.map((b) => join(dir, b));
}

/**
 * Resolve a `mod name [path]` statement relative to the directory of the
 * file that declared it. Returns the absolute path of the module source
 * file, or null when it does not exist.
 */
function resolveModFile(declaringDir: string, name: string, modPath: string | null): string | null {
  if (modPath !== null && modPath !== '') {
    if (modPath.startsWith('~')) return null; // outside the workspace — not followed
    const abs = resolve(declaringDir, modPath);
    for (const candidate of [
      abs,
      join(abs, 'mod.just'),
      join(abs, 'justfile'),
      join(abs, 'JUSTFILE'),
      join(abs, 'Justfile'),
      join(abs, '.justfile'),
    ]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }
  for (const candidate of defaultModPaths(declaringDir, name)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function readJustfile(absPath: string, relPath: string): ReturnType<typeof parseJustfile> | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    // Unreadable files must not break the project graph — warn and skip.
    logger.warn(`[${PLUGIN_SCOPE}] Could not read ${logSafe(relPath)} — skipping it`);
    return null;
  }
  try {
    return parseJustfile(text);
  } catch {
    // A broken justfile must not break the project graph — warn and skip.
    logger.warn(`[${PLUGIN_SCOPE}] Could not parse ${logSafe(relPath)} — skipping it`);
    return null;
  }
}

/**
 * Recursively resolve `mod` statements. `prefix` is the qualified path of
 * the containing module ('' for the top-level justfile); `visited`
 * dedupes cycles. Depth is capped at MAX_MOD_DEPTH.
 */
function collectModules(
  parsed: ReturnType<typeof parseJustfile>,
  declaringDir: string,
  projectDir: string,
  prefix: string,
  depth: number,
  visited: Set<string>,
  out: ResolvedModule[],
): void {
  if (depth > MAX_MOD_DEPTH || parsed === null) return;
  for (const mod of parsed.modules) {
    const qualified = prefix === '' ? mod.name : `${prefix}::${mod.name}`;
    const abs = resolveModFile(declaringDir, mod.name, mod.path);
    if (abs === null) {
      if (!mod.optional) {
        logDebug(PLUGIN_SCOPE, `mod ${logSafe(qualified)} has no source file — skipped`);
      }
      continue;
    }
    const canonical = resolve(abs);
    // `visited` is the active recursion path — it breaks cycles without
    // suppressing the same file reached under another mod name or from a
    // sibling subtree.
    if (visited.has(canonical)) continue;

    const rel = relTo(projectDir, abs);
    if (rel === null || rel.split('/').includes('node_modules')) {
      logDebug(
        PLUGIN_SCOPE,
        `mod ${logSafe(qualified)} resolves outside the project root or under node_modules — skipped`,
      );
      continue;
    }
    visited.add(canonical);
    const modParsed = readJustfile(abs, rel);
    if (modParsed !== null) {
      out.push({
        qualifiedName: qualified,
        relPath: rel,
        recipes: modParsed.recipes,
        aliases: modParsed.aliases,
      });
      collectModules(modParsed, dirname(abs), projectDir, qualified, depth + 1, visited, out);
    }
    visited.delete(canonical);
  }
}

/** Path of `abs` relative to `root`, using forward slashes. `null` when `abs` escapes `root`. */
function relTo(root: string, abs: string): string | null {
  const rel = relative(resolve(root), resolve(abs));
  // `..` escapes root; absolute again means a different drive/root.
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

function buildTarget(
  command: string,
  recipe: JustRecipe,
  dependsOn: { target: string }[],
  inputs: string[],
  commandName: string,
): TargetConfiguration {
  let description = recipe.doc !== '' ? recipe.doc : `\`just ${commandName}\``;
  if (recipe.params.length > 0) {
    description += ` — params: ${recipe.params.join(' ')} (pass values after \`--\`, e.g. \`nx run <proj>:<target> -- ${recipe.params
      .map((p) => `<${p.split('=')[0]!.replace(/^[+$*]+/, '')}>`)
      .join(' ')}\`)`;
  }
  const target: TargetConfiguration = {
    executor: 'nx:run-commands',
    cache: false,
    inputs,
    options: { command, cwd: '{projectRoot}', forwardAllArgs: true },
    metadata: { description: description.split('\n')[0] ?? '' },
  };
  if (dependsOn.length > 0) target.dependsOn = dependsOn;
  return target;
}

/** A value from the justfile, safe to put into a single log line. */
function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // Strip C0/C1 controls and bidi isolates/overrides — both can forge log
    // lines or re-order what a reader sees.
    out +=
      code < 32 ||
      (code >= 127 && code <= 159) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
        ? ' '
        : char;
  }
  return out.trim();
}

function isSkippedDir(dir: string): boolean {
  const segments = dir.split('/');
  return segments[0] === '..' || segments.includes('..') || segments.includes('node_modules');
}

/** just's search preference when several justfile names exist in one dir. */
const JUSTFILE_NAME_RANK = [
  'justfile',
  'just.just',
  'Justfile',
  '.justfile',
  '.Justfile',
  'JUSTFILE',
  '.JUSTFILE',
];

function justfileRank(path: string): number {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const rank = JUSTFILE_NAME_RANK.indexOf(base);
  return rank === -1 ? JUSTFILE_NAME_RANK.length : rank;
}

/** One justfile per directory — just's own search-order preference. */
function pickByDir(configFiles: readonly string[]): Array<readonly [string, string]> {
  const byDir = new Map<string, string>();
  for (const raw of [...configFiles].sort()) {
    const configFile = raw.startsWith('./') ? raw.slice(2) : raw;
    const dir = dirname(configFile).replace(/\\/g, '/');
    const key = dir === '.' ? '' : dir;
    const existing = byDir.get(key);
    if (existing === undefined || justfileRank(configFile) < justfileRank(existing)) {
      byDir.set(key, configFile);
    }
  }
  return [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Recipe-name → target-name registry so deps resolve forward references. */
function registerNames(
  parsed: JustfileData,
  modules: ResolvedModule[],
  prefix: string,
): Map<string, string> {
  const targetNames = new Map<string, string>();
  for (const r of parsed.recipes) {
    if (!r.private) targetNames.set(r.name, `${prefix}${r.name}`);
  }
  for (const m of modules) {
    for (const r of m.recipes) {
      if (!r.private)
        targetNames.set(`${m.qualifiedName}::${r.name}`, `${prefix}${m.qualifiedName}::${r.name}`);
    }
    for (const a of m.aliases) {
      targetNames.set(`${m.qualifiedName}::${a.name}`, `${prefix}${m.qualifiedName}::${a.name}`);
    }
  }
  for (const a of parsed.aliases) {
    targetNames.set(a.name, `${prefix}${a.name}`);
  }
  return targetNames;
}

interface EmitCtx {
  prefix: string;
  targetNames: Map<string, string>;
  inputs: string[];
  targets: Record<string, TargetConfiguration>;
  dir: string;
}

/**
 * Resolve a dep name as just does inside module `qualifier`: bare names
 * are module-local, `super::` climbs toward the root. `qualifier` is ''
 * for the top-level justfile.
 */
function qualifyDep(qualifier: string, dep: string): string {
  let q = qualifier;
  let d = dep;
  while (d.startsWith('super::')) {
    if (q === '') return dep; // `super::` at the root — let just resolve it
    const idx = q.lastIndexOf('::');
    q = idx === -1 ? '' : q.slice(0, idx);
    d = d.slice('super::'.length);
  }
  return q === '' ? d : `${q}::${d}`;
}

function emitRecipes(recipes: JustRecipe[], qualifier: string, ctx: EmitCtx): void {
  for (const r of recipes) {
    if (r.private) continue;
    const qualified = qualifier === '' ? r.name : `${qualifier}::${r.name}`;
    const targetName = `${ctx.prefix}${qualified}`;
    const depTargets = r.deps.map((d) => ctx.targetNames.get(qualifyDep(qualifier, d)));
    // Nx owns the deps only when every one maps to an emitted target and
    // the dep list is bare names — then `--no-deps` keeps just from
    // running each prerequisite a second time. Otherwise `just <name>`
    // runs its own deps and no dependsOn edge is emitted (partial edges
    // would double-run the mapped subset).
    const orchestrated =
      depTargets.length > 0 && depTargets.every((t) => t !== undefined) && r.depsArePlain;
    const dependsOn = orchestrated ? depTargets.map((t) => ({ target: t as string })) : [];
    const command = orchestrated ? `just --no-deps ${qualified}` : `just ${qualified}`;
    ctx.targets[targetName] = buildTarget(command, r, dependsOn, ctx.inputs, qualified);
    if (isVerbose()) {
      logDebug(PLUGIN_SCOPE, `Registered ${logSafe(ctx.dir || '.')}:${logSafe(targetName)}`);
    }
  }
}

/** Aliases run `just <alias>` — just resolves the alias itself. */
function emitAliases(aliases: JustAlias[], qualifier: string, ctx: EmitCtx): void {
  for (const a of aliases) {
    const qualified = qualifier === '' ? a.name : `${qualifier}::${a.name}`;
    ctx.targets[`${ctx.prefix}${qualified}`] = buildTarget(
      `just ${qualified}`,
      {
        name: a.name,
        params: [],
        deps: [],
        doc: `alias for \`${a.target}\``,
        quiet: false,
        private: false,
        depsArePlain: true,
      },
      [],
      ctx.inputs,
      qualified,
    );
  }
}

function inferProject(
  dir: string,
  configFile: string,
  workspaceRoot: string,
  prefix: string,
): {
  projects: Record<string, { root: string; targets: Record<string, TargetConfiguration> }>;
} | null {
  const projectDir = resolve(workspaceRoot, dir === '' ? '.' : dir);
  const parsed = readJustfile(join(workspaceRoot, configFile), configFile);
  if (parsed === null) return null;

  const modules: ResolvedModule[] = [];
  collectModules(
    parsed,
    projectDir,
    projectDir,
    '',
    0,
    new Set([resolve(join(workspaceRoot, configFile))]),
    modules,
  );

  const justfileName = dir === '' ? configFile : configFile.slice(dir.length + 1);
  const inputs = [
    `{projectRoot}/${justfileName}`,
    ...modules.map((m) => `{projectRoot}/${m.relPath}`),
  ];

  const targets: Record<string, TargetConfiguration> = Object.create(null);
  const ctx: EmitCtx = {
    prefix,
    targetNames: registerNames(parsed, modules, prefix),
    inputs,
    targets,
    dir,
  };

  emitRecipes(parsed.recipes, '', ctx);
  emitAliases(parsed.aliases, '', ctx);
  for (const m of modules) {
    emitRecipes(m.recipes, m.qualifiedName, ctx);
    emitAliases(m.aliases, m.qualifiedName, ctx);
  }

  if (Object.keys(targets).length === 0) return null;
  return { projects: { [dir]: { root: dir, targets } } };
}

/**
 * Infer Nx targets from a justfile: every public recipe becomes a
 * `<prefix><name>` target running `just <name>` in the justfile's
 * directory. `mod` statements are followed when their source file
 * resolves; module recipes get `mod::recipe` target names. Prior deps
 * become `dependsOn` on the same project when every dep maps to a
 * target (and the command runs `just --no-deps` so prerequisites are
 * not executed twice); arg'd or subsequent (`&&`) deps stay with just.
 * Private recipes (`_name`, `[private]`) are skipped.
 */
export const createNodesV2: CreateNodesV2<NxDevkitJustOptions> = [
  JUSTFILE_GLOB,
  (configFiles, options = {}, context): CreateNodesResultArray => {
    const workspaceRoot = context.workspaceRoot;
    const prefix = options.targetPrefix ?? DEFAULT_TARGET_PREFIX;
    const results: CreateNodesResultArray = [];

    for (const [dir, configFile] of pickByDir(configFiles)) {
      if (isSkippedDir(dir)) {
        logDebug(PLUGIN_SCOPE, `Skipping ${logSafe(configFile)} — outside the workspace`);
        continue;
      }
      const project = inferProject(dir, configFile, workspaceRoot, prefix);
      if (project !== null) results.push([configFile, project]);
    }

    return results;
  },
];

export default createNodesV2;

export const __testing: { JUSTFILE_GLOB: typeof JUSTFILE_GLOB } = { JUSTFILE_GLOB };
