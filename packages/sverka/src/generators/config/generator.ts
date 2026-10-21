import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit'
import { resolveRootProjectName } from '@nx-devkit/internal'
import { GITHUB_CHECKS, GITHUB_CHECK_IDS } from './github-checks.js'

export interface NxDevkitSverkaConfigOptions {
  /** Nx project the config describes. Default: the root project. */
  project?: string
  /** Where to write the config. Default: `<projectRoot>/sverka.config.ts`. */
  path?: string
  /** Name of the CI pipeline. Default: `ci`. */
  pipeline?: string
  /** Name of the push entry. Default: `on-push`. */
  entry?: string
  /**
   * Checks to include.
   *
   * Default: the checks detected in the project (package.json scripts and
   * Nx targets named after a known check).
   */
  checks?: string[]
  /**
   * GitHub-side checks to add to a `repo-health` pipeline.
   *
   * Available: `main-green`, `review-debt` (GraphQL), `dependabot-alerts`,
   * `code-scanning`, `secret-scanning`, `stale-branches`, `open-prs`.
   */
  githubChecks?: string[]
  /** Overwrite an existing config. */
  force?: boolean
}

/** package.json script names that map to a sverka step. */
const KNOWN_CHECKS = ['lint', 'typecheck', 'test', 'build', 'format', 'check'] as const

/** A check the generated config can run. */
interface DetectedCheck {
  id: string
  command: string
}

/**
 * Generate a sverka config from what the project already has.
 */
export async function configGenerator(
  tree: Tree,
  options: NxDevkitSverkaConfigOptions = {},
): Promise<GeneratorCallback> {
  const projects = readProjects(tree)
  const projectName = options.project ?? resolveRootProjectName(tree)
  const project = projectName ? projects.get(projectName) : undefined
  const projectRoot = project?.root ?? ''

  const configPath = options.path ?? `${projectRoot}/sverka.config.ts`.replace(/^\//, '')
  if (tree.exists(configPath) && !options.force) {
    throw new Error(`${configPath} already exists — pass --force to overwrite it`)
  }

  const checks = resolveChecks(tree, projectName, projectRoot, options.checks)
  if (checks.length === 0) {
    throw new Error(
      `no checks found in ${projectRoot || 'the workspace root'} — pass --checks to pick them explicitly`,
    )
  }

  const githubChecks = (options.githubChecks ?? []).filter((id) => {
    if (GITHUB_CHECKS[id]) return true
    console.warn(`Unknown GitHub check "${id}" — available: ${GITHUB_CHECK_IDS.join(', ')}`)
    return false
  })

  tree.write(
    configPath,
    renderConfig({
      projectName: projectName ?? 'workspace',
      pipeline: options.pipeline ?? 'ci',
      entry: options.entry ?? 'on-push',
      checks,
      githubChecks,
    }),
  )

  const checklist = [
    `1. Wrote ${configPath}`,
    '2. Inspect the inferred Nx targets:',
    `   bunx nx show project ${projectName ?? '<root-project>'} --json`,
    '3. Run one step:',
    `   bunx nx run ${projectName ?? '<root-project>'}:${options.pipeline ?? 'ci'}:${checks[0]?.id}`,
  ]
  for (const line of checklist) console.log(line)

  await formatFiles(tree)

  return () => {}
}

/**
 * Pick the checks the config should run.
 *
 * A check is a package.json script of the project, or — when the project
 * has no such script — an Nx target with the same name.
 */
function resolveChecks(
  tree: Tree,
  projectName: string | undefined,
  projectRoot: string,
  requested: string[] | undefined,
): DetectedCheck[] {
  if (requested && requested.length > 0) {
    const pm = detectPackageManager(tree, projectRoot)
    return requested.map((id) => ({ id, command: `${pm} run ${id}` }))
  }

  const scripts = readScripts(tree, projectRoot)
  const pm = detectPackageManager(tree, projectRoot)
  const targets = readTargetNames(tree, projectRoot)

  const checks: DetectedCheck[] = []
  for (const id of KNOWN_CHECKS) {
    if (id in scripts) {
      checks.push({ id, command: `${pm} run ${id}` })
      continue
    }
    if (targets.has(id) && projectName) {
      checks.push({ id, command: `nx run ${projectName}:${id}` })
    }
  }
  return checks
}

/** package.json scripts of a project. */
function readScripts(tree: Tree, projectRoot: string): Record<string, string> {
  const pkg = readJsonFile(tree, `${projectRoot}/package.json`)
  const scripts: Record<string, string> = {}
  for (const [name, value] of Object.entries(pkg?.scripts ?? {})) {
    if (typeof value === 'string' && value.length > 0) scripts[name] = value
  }
  return scripts
}

/**
 * Read a JSON file from the tree.
 *
 * Returns `null` when the file is missing or malformed — the caller
 * decides what to do without it.
 */
function readJsonFile(tree: Tree, path: string): Record<string, unknown> | null {
  const normalized = path.replace(/^\//, '')
  if (!tree.exists(normalized)) return null
  try {
    const parsed = JSON.parse(tree.read(normalized, 'utf8') ?? '{}')
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Target names declared by a project's project.json. */
function readTargetNames(tree: Tree, projectRoot: string): Set<string> {
  const project = readJsonFile(tree, `${projectRoot}/project.json`)
  return new Set(Object.keys(project?.targets ?? {}))
}

/** A project declared by a project.json in the tree. */
interface TreeProject {
  root: string
  targets: Set<string>
}

/**
 * Every project of the tree, keyed by name.
 *
 * A project is declared by a project.json, or — for the projects Nx
 * infers from package.json — by the package.json name. The tree is the
 * only source of truth here: the generator must not read the filesystem,
 * which may not be the workspace the generator runs against.
 */
function readProjects(tree: Tree): Map<string, TreeProject> {
  const projects = new Map<string, TreeProject>()
  for (const path of listFiles(tree)) {
    if (path.endsWith('project.json')) {
      const content = tree.read(path, 'utf8')
      if (content === null) continue
      let parsed: {
        name?: string
        projectName?: string
        root?: string
        targets?: Record<string, unknown>
      }
      try {
        parsed = JSON.parse(content)
      } catch {
        continue
      }
      const root = parsed.root ?? dirnameOf(path)
      const name = parsed.name ?? parsed.projectName ?? basename(root)
      projects.set(name, {
        root,
        targets: new Set(Object.keys(parsed.targets ?? {})),
      })
      continue
    }

    if (!path.endsWith('package.json')) continue
    const content = tree.read(path, 'utf8')
    if (content === null) continue
    let parsed: { name?: string }
    try {
      parsed = JSON.parse(content)
    } catch {
      continue
    }
    if (!parsed.name) continue
    const root = dirnameOf(path)
    if (projects.has(parsed.name)) continue
    projects.set(parsed.name, { root, targets: new Set() })
  }
  return projects
}

/** Every file of the tree, relative to the workspace root. */
function listFiles(tree: Tree, dir = ''): string[] {
  const files: string[] = []
  for (const child of tree.children(dir)) {
    const path = dir ? `${dir}/${child}` : child
    if (tree.isFile(path)) {
      files.push(path)
      continue
    }
    files.push(...listFiles(tree, path))
  }
  return files
}

/** Directory of a workspace-relative file path. */
function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

/** Last segment of a path. */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** Package manager the project uses. */
function detectPackageManager(tree: Tree, projectRoot: string): string {
  const lockfiles: [string, string][] = [
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ]
  for (const [lockfile, pm] of lockfiles) {
    if (tree.exists(lockfile)) return pm
  }
  const path = `${projectRoot}/package.json`.replace(/^\//, '')
  if (tree.exists(path)) {
    try {
      const pkg = JSON.parse(tree.read(path, 'utf8') ?? '{}') as {
        packageManager?: string
      }
      const field = pkg.packageManager
      if (typeof field === 'string') {
        const name = field.split('@')[0] ?? ''
        if (['bun', 'npm', 'pnpm', 'yarn'].includes(name)) return name
      }
    } catch {
      // fall through
    }
  }
  return 'npm'
}

/** Render the sverka config file. */
function renderConfig(input: {
  projectName: string
  pipeline: string
  entry: string
  checks: DetectedCheck[]
  githubChecks: string[]
}): string {
  const lines: string[] = [
    '// Generated by @nx-devkit/sverka — edit freely.',
    '//',
    '// Every step becomes an Nx target with its own inputs, outputs and cache:',
    '//   nx run <project>:<pipeline>:<step>',
    '',
    'import {',
    '  Project,',
    '  Pipeline,',
    '  ShellStep,',
    '  Entry,',
    '  push,',
    ...(input.githubChecks.length > 0 ? ['  manual,'] : []),
    "} from '@sverka/workflow'",
    '',
    `const proj = new Project(${JSON.stringify(input.projectName)})`,
    '',
    `const ${input.pipeline} = new Pipeline(proj, ${JSON.stringify(input.pipeline)})`,
    '',
  ]

  for (const check of input.checks) {
    lines.push(
      `new ShellStep(${input.pipeline}, ${JSON.stringify(check.id)}, { command: ${JSON.stringify(check.command)} })`,
    )
  }

  lines.push(
    '',
    `export const ${camel(input.entry)} = new Entry(${input.pipeline}, ${JSON.stringify(input.entry)}, {`,
    '  trigger: push(),',
    `  roots: [${input.checks.map((check) => JSON.stringify(check.id)).join(', ')}],`,
    '})',
  )

  if (input.githubChecks.length > 0) {
    lines.push(
      '',
      '// ── GitHub-side repository health ──────────────────────────────────',
      '// These check the state of the repository on GitHub, not the code.',
      'const repoHealth = new Pipeline(proj, "repo-health", {',
      '  permissions: {',
      '    contents: "read",',
      '    "pull-requests": "read",',
      '    checks: "read",',
      '    "security-events": "read",',
      '    actions: "read",',
      '  },',
      '  inputs: {',
      '    GITHUB_TOKEN: { type: "string", secret: true, default: "" },',
      '  },',
      '  bootstrap: "checkout",',
      '})',
      '',
    )

    for (const id of input.githubChecks) {
      const check = GITHUB_CHECKS[id]
      if (!check) continue
      const runtime: string[] = ['shell: "sh"']
      if (check.secret) runtime.push(`secrets: [${JSON.stringify(check.secret)}]`)
      lines.push(
        `// ${check.description}`,
        `new ShellStep(repoHealth, ${JSON.stringify(check.id)}, {`,
        `  command: ${JSON.stringify(check.command)},`,
        `  runtime: { ${runtime.join(', ')} },`,
        '})',
        '',
      )
    }

    lines.push(
      'export const repoHealthCheck = new Entry(repoHealth, "check", {',
      '  trigger: manual(),',
      `  roots: [${input.githubChecks.map((id) => JSON.stringify(id)).join(', ')}],`,
      '})',
    )
  }

  lines.push('', 'export default proj', '')
  return lines.join('\n')
}

/** `on-push` → `onPush`. */
function camel(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

export default configGenerator
