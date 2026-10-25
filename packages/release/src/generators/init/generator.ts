import { type GeneratorCallback, type Tree, joinPathFragments } from '@nx/devkit'

export interface NxReleaseInitOptions {
  /** Name of the tools project to create or update. Default: "tools". */
  projectName?: string
  /** npm package name to publish. Default: derived from root package.json. */
  packageName?: string
  /** Path to the package directory containing package.json. Default: "packages/cli". */
  packagePath?: string
  /** Branch to push the bump commit to. Default: "main". */
  branch?: string
}

const DEFAULT_PROJECT_NAME = 'tools'
const DEFAULT_PACKAGE_PATH = 'packages/cli'
const PLUGIN_NAME = '@nx-devkit/release'

function readJson(tree: Tree, path: string): Record<string, unknown> | null {
  if (!tree.exists(path)) return null
  try {
    return JSON.parse(tree.read(path, 'utf8') ?? '{}') as Record<string, unknown>
  } catch {
    return null
  }
}

function writeJson(tree: Tree, path: string, value: unknown): void {
  tree.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

function registerPlugin(tree: Tree, pluginPath: string): void {
  const nxJson = readJson(tree, 'nx.json') ?? {}
  const plugins = Array.isArray(nxJson.plugins) ? (nxJson.plugins as unknown[]) : []
  const already = plugins.some(
    (entry) =>
      (typeof entry === 'string' && entry === pluginPath) ||
      (typeof entry === 'object' &&
        entry !== null &&
        (entry as { plugin?: string }).plugin === pluginPath),
  )
  if (!already) {
    plugins.push({ options: {}, plugin: pluginPath })
    nxJson.plugins = plugins
    writeJson(tree, 'nx.json', nxJson)
  }
}

function ensureToolsProject(
  tree: Tree,
  projectName: string,
  packageName: string,
  packagePath: string,
): void {
  const projectJsonPath = joinPathFragments(projectName, 'project.json')

  if (tree.exists(projectJsonPath)) {
    const existing = readJson(tree, projectJsonPath)
    if (existing) {
      const targets = (existing.targets ?? {}) as Record<string, Record<string, unknown>>
      if (!targets['release']) {
        targets['release'] = {
          executor: `${PLUGIN_NAME}:publish`,
          options: { packagePath, packageName },
        }
        existing.targets = targets
        writeJson(tree, projectJsonPath, existing)
      }
    }
    return
  }

  const project = {
    $schema: '../../node_modules/nx/schemas/project-schema.json',
    name: projectName,
    sourceRoot: projectName,
    targets: {
      release: {
        executor: `${PLUGIN_NAME}:publish`,
        options: { packagePath, packageName },
      },
    },
  }
  writeJson(tree, projectJsonPath, project)
  tree.write(joinPathFragments(projectName, '.gitkeep'), '')
}

function createReleaseWorkflow(tree: Tree, projectName: string): void {
  const workflowPath = '.github/workflows/release.yml'

  if (tree.exists(workflowPath)) {
    // Try to migrate an existing generated workflow from --version to --releaseVersion
    // Only migrate if it matches the previously generated template exactly
    const existing = tree.read(workflowPath, 'utf-8')

    // Check if this is a previously generated workflow by looking for the exact Nx release step
    const oldReleaseStep = `npx nx run ${projectName}:release \\\n            --version="\${{ inputs.version }}" \\\n            --dryRun="\${{ inputs.dry-run }}"`
    const newReleaseStep = `npx nx run ${projectName}:release \\\n            --releaseVersion="\${{ inputs.version }}" \\\n            --dryRun="\${{ inputs.dry-run }}"`

    if (existing.includes(oldReleaseStep) && !existing.includes(newReleaseStep)) {
      let migrated = existing.replace(oldReleaseStep, newReleaseStep)

      // Also remove NODE_AUTH_TOKEN and environment: npm from previously generated workflows
      // These break --provenance and can stall the workflow
      // Use simple string operations to avoid ReDoS-vulnerable regex
      const setupNodeStart = migrated.indexOf('      - name: Setup Node.js')
      const registryUrlEnd = migrated.indexOf(
        "registry-url: 'https://registry.npmjs.org'",
        setupNodeStart,
      )
      if (setupNodeStart !== -1 && registryUrlEnd !== -1) {
        const registryUrlLineEnd = migrated.indexOf('\n', registryUrlEnd)
        if (registryUrlLineEnd !== -1) {
          const before = migrated.slice(0, setupNodeStart)
          const after = migrated.slice(registryUrlLineEnd + 1)
          migrated =
            before +
            `      - name: Setup Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: lts/*
          check-latest: true
          registry-url: 'https://registry.npmjs.org'
` +
            after
        }
      }

      // Remove NODE_AUTH_TOKEN from the Release step env (handle multiple formats)
      const envWithTokenVariants = [
        'env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}',
        'env:\n  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}',
        'env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n',
      ]
      const envWithoutToken = 'env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}'
      for (const variant of envWithTokenVariants) {
        if (migrated.includes(variant)) {
          migrated = migrated.replace(variant, envWithoutToken)
          break
        }
      }

      // Remove environment: npm only from the release job
      // Find the release job first, then remove environment: npm from it
      const releaseJobStart = migrated.indexOf('  release:')
      if (releaseJobStart !== -1) {
        const nextJobStart = migrated.indexOf('\n  ', releaseJobStart + 1)
        const jobContent =
          nextJobStart !== -1
            ? migrated.slice(releaseJobStart, nextJobStart)
            : migrated.slice(releaseJobStart)
        const beforeJob = migrated.slice(0, releaseJobStart)
        const afterJob = nextJobStart !== -1 ? migrated.slice(nextJobStart) : ''
        // Handle both 4-space and 2-space indentation for environment: npm
        const envNpmLine4 = '    environment: npm'
        const envNpmLine2 = '  environment: npm'
        if (jobContent.includes(envNpmLine4)) {
          const fixedJobContent = jobContent.replace(envNpmLine4 + '\n', '')
          migrated = beforeJob + fixedJobContent + afterJob
        } else if (jobContent.includes(envNpmLine2)) {
          const fixedJobContent = jobContent.replace(envNpmLine2 + '\n', '')
          migrated = beforeJob + fixedJobContent + afterJob
        }
      }

      tree.write(workflowPath, migrated)
      console.log(`Migrated existing release.yml from --version to --releaseVersion`)
    }
    // If it doesn't match the old template, assume it's customized and leave it
    return
  }

  const workflow = `name: Release

concurrency:
  group: release

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to release (x.y.z, or patch|minor|major vs npm latest)'
        required: false
        default: 'patch'
        type: string
      dry-run:
        description: 'Dry run (verify only — no tag, publish, or release)'
        required: false
        default: 'true'
        type: choice
        options:
          - 'true'
          - 'false'

permissions:
  contents: write
  id-token: write

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          submodules: true

      - name: Setup Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: lts/*
          check-latest: true
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm ci --ignore-scripts

      - name: Build
        run: npx nx run-many -t build

      - name: Typecheck
        run: npx nx run-many -t typecheck

      - name: Lint
        run: npx nx run-many -t lint

      - name: Test
        run: npx nx run-many -t test

      - name: Release
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          npx nx run ${projectName}:release \\
            --releaseVersion="\${{ inputs.version }}" \\
            --dryRun="\${{ inputs.dry-run }}"
`

  tree.write(workflowPath, workflow)
}

export async function initGenerator(
  tree: Tree,
  options: NxReleaseInitOptions = {},
): Promise<GeneratorCallback> {
  const projectName = options.projectName ?? DEFAULT_PROJECT_NAME
  const packagePath = options.packagePath ?? DEFAULT_PACKAGE_PATH

  // Derive package name from root package.json if not provided
  let packageName = options.packageName
  if (!packageName) {
    const rootPkg = readJson(tree, 'package.json')
    const rootName = rootPkg?.name as string | undefined
    if (!rootName) {
      throw new Error(
        'Could not determine package name. Set options.packageName or add "name" to package.json.',
      )
    }
    packageName = rootName
  }

  registerPlugin(tree, PLUGIN_NAME)
  ensureToolsProject(tree, projectName, packageName, packagePath)
  createReleaseWorkflow(tree, projectName)

  const checklist = [
    `1. Install the plugin: npm install -D ${PLUGIN_NAME}`,
    `2. Run a dry run: npx nx run ${projectName}:release --releaseVersion=patch --dryRun=true`,
    `3. Run a real release: gh workflow run release.yml -f version=patch -f dry-run=false`,
    '4. The workflow publishes to npm via OIDC, pushes the bump+tag to main, and creates a GitHub Release.',
  ]
  for (const line of checklist) console.log(line)

  return () => {
    /* No-op */
  }
}

export default initGenerator
