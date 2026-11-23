import { globSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  createProjectGraphAsync,
  logger,
  type ExecutorContext,
  type ProjectGraph,
} from '@nx/devkit';
import { isVerbose, logDebug } from '@nx-devkit/internal';
import { collectImports } from '../../imports.ts';
import { evaluateConstraints, evaluateExternal } from '../../constraints.ts';
import { findCircularDependencies } from '../../cycles.ts';
import { renderReport, renderTextLines, type BoundaryViolation } from '../../report.ts';
import { externalPackageName, loadTsPaths, resolveImport } from '../../resolve.ts';
import { projectIndex, projectTags } from '../../tags.ts';
import type { DepConstraint, ReportFormat, TagInference } from '../../types.ts';

interface CheckBoundariesOptions {
  depConstraints?: DepConstraint[];
  /** Restrict the check to one project — set by the inferred per-project targets. */
  project?: string;
  inferTags?: boolean | TagInference;
  /** Report circular dependencies from the project graph. Default: true. */
  checkCircularDependencies?: boolean;
  format?: ReportFormat;
}

interface ScanContext {
  workspaceRoot: string;
  index: ReturnType<typeof projectIndex>;
  tsPaths: ReturnType<typeof loadTsPaths>;
  tags: Map<string, string[]>;
  constraints: DepConstraint[];
}

const SOURCE_GLOB = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

// Node's globSync `exclude` semantics for pattern arrays vary by version —
// a segment callback is unambiguous everywhere.
const isExcluded = (p: string): boolean => {
  const segs = p.split(/[\\/]/);
  return segs.includes('node_modules') || segs.includes('dist') || p.endsWith('.d.ts');
};

function constraintViolation(
  rel: string,
  line: number,
  projectName: string,
  sourceTags: string[],
  target: string,
  targetTags: string[],
  specifier: string,
  check: ReturnType<typeof evaluateConstraints>,
): BoundaryViolation {
  const tagList = (tags: string[]) => tags.join(',') || 'untagged';
  const sourceTag = check.constraint?.sourceTag ?? '';
  const hint =
    check.reason === 'banned-tag'
      ? `'${sourceTag}' sources may not depend on ${JSON.stringify(
          check.constraint?.notDependOnLibsWithTags ?? [],
        )} — remove the import or retag '${target}'`
      : `add a matching tag to onlyDependOnLibsWithTags of the '${sourceTag}' constraint, retag '${target}', or remove the import`;
  return {
    kind: 'constraint',
    file: rel,
    line,
    source: projectName,
    sourceTags,
    target,
    targetTags,
    specifier,
    message: `${projectName} (${tagList(sourceTags)}) cannot depend on ${target} (${tagList(targetTags)}) via "${specifier}"`,
    hint,
  };
}

function externalViolation(
  rel: string,
  line: number,
  projectName: string,
  sourceTags: string[],
  packageName: string,
  specifier: string,
  check: ReturnType<typeof evaluateExternal>,
): BoundaryViolation {
  const sourceTag = check.constraint?.sourceTag ?? '';
  const hint =
    check.reason === 'banned-external'
      ? `remove the '${packageName}' import or drop it from bannedExternalDeps of the '${sourceTag}' constraint`
      : `add '${packageName}' to allowedExternalDeps of the '${sourceTag}' constraint or remove the import`;
  return {
    kind: 'external',
    file: rel,
    line,
    source: projectName,
    sourceTags,
    target: packageName,
    specifier,
    message: `${projectName} (${sourceTags.join(',') || 'untagged'}) cannot depend on external package "${packageName}" via "${specifier}"`,
    hint,
  };
}

function scanProject(
  projectName: string,
  sourceTags: string[],
  root: string,
  ctx: ScanContext,
): BoundaryViolation[] {
  const absRoot = join(ctx.workspaceRoot, root);
  const files = globSync(SOURCE_GLOB, { cwd: absRoot, exclude: isExcluded });
  logDebug('nx-devkit/boundaries', `${projectName}: scanning ${files.length} files`);

  const violations: BoundaryViolation[] = [];
  for (const file of files) {
    const fileAbs = join(absRoot, file);
    // globSync sweeps nested project roots too — index.roots is sorted
    // longest-first, so the owning project is the deepest root containing the
    // file. Files belonging to a nested project are checked under their own
    // tags during that project's scan, not under the parent's.
    const rel = relative(ctx.workspaceRoot, fileAbs).replace(/\\/g, '/');
    const owner = ctx.index.roots.find((r) => rel === r.root || rel.startsWith(`${r.root}/`));
    if (owner && owner.name !== projectName) continue;
    let source: string;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a workspace source file under an inferred project root
      source = readFileSync(fileAbs, 'utf8');
    } catch (error) {
      logger.warn(
        `check-boundaries: skipping unreadable file ${fileAbs}: ${(error as Error).message}`,
      );
      continue;
    }
    const records = collectImports(fileAbs, source);
    for (const record of records) {
      const target = resolveImport(
        record.specifier,
        fileAbs,
        ctx.index,
        ctx.tsPaths,
        ctx.workspaceRoot,
      );
      if (target === projectName) {
        continue;
      }
      if (target) {
        const targetTags = ctx.tags.get(target) ?? [];
        const check = evaluateConstraints(sourceTags, targetTags, ctx.constraints);
        if (!check.allowed) {
          violations.push(
            constraintViolation(
              rel,
              record.line,
              projectName,
              sourceTags,
              target,
              targetTags,
              record.specifier,
              check,
            ),
          );
        }
        continue;
      }
      // Unresolvable bare specifier → external (npm) dependency.
      const packageName = externalPackageName(record.specifier);
      if (!packageName) {
        continue;
      }
      const check = evaluateExternal(packageName, sourceTags, ctx.constraints);
      if (!check.allowed) {
        violations.push(
          externalViolation(
            rel,
            record.line,
            projectName,
            sourceTags,
            packageName,
            record.specifier,
            check,
          ),
        );
      }
    }
  }
  return violations;
}

function cycleViolation(cycle: string[]): BoundaryViolation {
  return {
    kind: 'circular',
    source: cycle[0]!,
    target: cycle[cycle.length - 2] ?? cycle[0]!,
    message: `circular dependency: ${cycle.join(' -> ')}`,
    hint: 'break the cycle — extract the shared code into a new project or invert one edge (e.g. depend on an interface layer)',
  };
}

/** Resolve `--project` (name or root) to a graph node name; throws when unknown. */
function resolveProjectName(ref: string, graph: ProjectGraph): string {
  if (graph.nodes[ref]) {
    return ref;
  }
  const byRoot = Object.entries(graph.nodes).find(
    ([, node]) => node.data.root.replace(/\\/g, '/') === ref.replace(/\\/g, '/'),
  );
  if (byRoot) {
    return byRoot[0];
  }
  throw new Error(
    `check-boundaries: unknown project "${ref}" — pass an Nx project name or project root`,
  );
}

/** Edge-scan every in-scope project plus cycle detection. */
function collectViolations(
  graph: ProjectGraph,
  ctx: ScanContext,
  scopedProject: string | undefined,
  options: CheckBoundariesOptions,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const [projectName, node] of Object.entries(graph.nodes)) {
    if (scopedProject !== undefined && projectName !== scopedProject) {
      continue;
    }
    const sourceTags = ctx.tags.get(projectName) ?? [];
    const root = node.data.root;
    // Untagged projects are unconstrained (permissive default).
    // The root project is excluded — it is not a boundary citizen.
    if (sourceTags.length === 0 || root === '.' || root === '') {
      continue;
    }
    violations.push(...scanProject(projectName, sourceTags, root, ctx));
  }

  if (options.checkCircularDependencies ?? true) {
    for (const cycle of findCircularDependencies(graph)) {
      if (scopedProject !== undefined && !cycle.includes(scopedProject)) {
        continue;
      }
      violations.push(cycleViolation(cycle));
    }
  }
  return violations;
}

/** Emit violations in the requested format; returns success. */
function emitViolations(violations: BoundaryViolation[], format: string): boolean {
  if (violations.length === 0) {
    if (format === 'json' || format === 'mermaid') {
      process.stdout.write(`${renderReport([], format)}\n`);
    } else if (isVerbose()) {
      logger.info('check-boundaries: no violations');
    }
    return true;
  }
  logger.error(`check-boundaries: ${violations.length} violation(s)`);
  if (format === 'json' || format === 'mermaid') {
    process.stdout.write(`${renderReport(violations, format)}\n`);
  } else {
    for (const line of renderTextLines(violations)) {
      logger.error(line);
    }
  }
  return false;
}

export default async function checkBoundaries(
  options: CheckBoundariesOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const graph: ProjectGraph = context.projectGraph ?? (await createProjectGraphAsync());
  const ctx: ScanContext = {
    workspaceRoot: context.root,
    index: projectIndex(graph),
    tsPaths: loadTsPaths(context.root),
    tags: projectTags(graph, options.inferTags),
    constraints: options.depConstraints ?? [],
  };

  const scopedProject =
    options.project === undefined ? undefined : resolveProjectName(options.project, graph);
  const violations = collectViolations(graph, ctx, scopedProject, options);
  return { success: emitViolations(violations, options.format ?? 'text') };
}
