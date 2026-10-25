import {
  type GeneratorCallback,
  type Tree,
  formatFiles,
  addDependenciesToPackageJson,
} from '@nx/devkit'
import { parse, modify, applyEdits, printParseErrorCode } from 'jsonc-parser'

export interface NxTypescriptMonorepoOptions {
  /** Name of the first package (also used as the workspace name). */
  name: string
  /** Directory for the first package. Default: "packages". */
  packageDir?: 'packages' | 'apps' | 'libs'
  /** Skip adding dependencies to package.json. Default: false. */
  skipInstall?: boolean
  /** Package manager to use for install instructions. Default: "bun". */
  packageManager?: 'bun' | 'npm' | 'pnpm' | 'yarn'
  /** Include test configuration (vitest). Default: true. */
  test?: boolean
  /** Include lint configuration (oxlint). Default: true. */
  lint?: boolean
  /** Include format configuration (biome). Default: true. */
  format?: boolean
  /** Include build configuration (tsdown). Default: true. */
  build?: boolean
  /** Use native Node test runner instead of vitest. Default: false. */
  nativeTest?: boolean
}

const DEFAULT_OPTIONS: Required<Omit<NxTypescriptMonorepoOptions, 'name'>> = {
  packageDir: 'packages',
  skipInstall: false,
  packageManager: 'bun',
  test: true,
  lint: true,
  format: true,
  build: true,
  nativeTest: false,
}

const DEP_VERSIONS: Record<string, string> = {
  tsdown: '^0.22.3',
  oxlint: '^1.0.0',
  eslint: '^9.0.0',
  '@biomejs/biome': '^2.0.0',
  vitest: '^4.1.9',
  typescript: '^6.0.3',
  '@typescript/native-preview': '^7.0.0-dev.20260621.1',
}

function readJson(tree: Tree, path: string): Record<string, unknown> | null {
  if (!tree.exists(path)) return null
  const raw = tree.read(path, 'utf8')
  if (raw === null) return null
  const errors: NonNullable<Parameters<typeof parse>[1]> = []
  const value = parse(raw, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    throw new Error(
      `Failed to parse ${path}: ${errors.map((e) => printParseErrorCode(e.error)).join(', ')}`,
    )
  }
  return value as Record<string, unknown>
}

function writeJson(tree: Tree, path: string, value: unknown): void {
  tree.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

function getWorkspaceGlobs(packageDir: string): string[] {
  const base = packageDir.endsWith('/') ? packageDir.slice(0, -1) : packageDir
  return [`${base}/*`, `${base}/@*/*`]
}

function ensureRootPackageJson(tree: Tree, workspaceName: string, packageDir: string): void {
  const workspaceGlobs = getWorkspaceGlobs(packageDir)
  if (!tree.exists('package.json')) {
    writeJson(tree, 'package.json', {
      name: workspaceName,
      version: '0.0.0',
      private: true,
      workspaces: workspaceGlobs,
      packageManager: 'bun@latest',
    })
  } else {
    const raw = tree.read('package.json', 'utf-8')
    if (raw === null || raw.trim() === '') {
      writeJson(tree, 'package.json', {
        name: workspaceName,
        version: '0.0.0',
        private: true,
        workspaces: workspaceGlobs,
        packageManager: `${options.packageManager}@latest`,
      })
      return
    }
    const errors: NonNullable<Parameters<typeof parse>[1]> = []
    const pkg = parse(raw, errors, { allowTrailingComma: true }) as Record<string, unknown>
    if (errors.length > 0) {
      throw new Error(
        `Failed to parse package.json: ${errors.map((e) => printParseErrorCode(e.error)).join(', ')}`,
      )
    }
    const existingWorkspaces =
      (pkg.workspaces as
        | string[]
        | { packages?: string[]; apps?: string[]; libs?: string[] }
        | undefined) ?? []
    let workspaces: string[] = []
    const isObjectForm =
      typeof existingWorkspaces === 'object' &&
      existingWorkspaces !== null &&
      !Array.isArray(existingWorkspaces)
    if (Array.isArray(existingWorkspaces)) {
      workspaces = [...existingWorkspaces]
    } else if (isObjectForm) {
      workspaces = [
        ...(existingWorkspaces.packages ?? []),
        ...(existingWorkspaces.apps ?? []),
        ...(existingWorkspaces.libs ?? []),
      ]
    }
    const globs = getWorkspaceGlobs(packageDir)
    const missing = globs.filter((g) => !workspaces.includes(g))
    if (missing.length > 0) {
      // Use jsonc-parser modify to preserve formatting and comments
      // Use array-element paths to preserve comments inside arrays/objects
      // Handle case where workspaces doesn't exist yet - create it first
      const eol = raw.includes('\r\n') ? '\r\n' : '\n'
      const indentMatch = raw.match(/^\s*/)
      const indent = indentMatch ? indentMatch[0].length : 2
      const formattingOptions = { insertSpaces: true, tabSize: indent, eol }
      let updated = raw
      if (isObjectForm) {
        // For object form, ensure packages array exists, then add missing globs
        if (existingWorkspaces.packages === undefined) {
          // Create the packages array with missing globs
          const edits = modify(updated, ['workspaces', 'packages'], missing, { formattingOptions })
          updated = applyEdits(updated, edits)
        } else {
          const existingPackages = existingWorkspaces.packages ?? []
          for (const [index, glob] of missing.entries()) {
            const edits = modify(
              updated,
              ['workspaces', 'packages', existingPackages.length + index],
              glob,
              { formattingOptions },
            )
            updated = applyEdits(updated, edits)
          }
        }
      } else {
        // For array form, ensure workspaces array exists, then add missing globs
        if (workspaces.length === 0) {
          // Create the workspaces array with missing globs
          const edits = modify(updated, ['workspaces'], missing, { formattingOptions })
          updated = applyEdits(updated, edits)
        } else {
          for (const [index, glob] of missing.entries()) {
            const edits = modify(updated, ['workspaces', workspaces.length + index], glob, {
              formattingOptions,
            })
            updated = applyEdits(updated, edits)
          }
        }
      }
      tree.write('package.json', updated)
    }
  }
}

function ensureNxJson(tree: Tree): void {
  if (!tree.exists('nx.json')) {
    writeJson(tree, 'nx.json', {
      $schema: './node_modules/nx/schemas/nx-schema.json',
      plugins: ['@nx-devkit/typescript'],
    })
  } else {
    const raw = tree.read('nx.json', 'utf-8')
    if (raw === null || raw.trim() === '') {
      // Treat empty or whitespace-only nx.json like a missing file
      writeJson(tree, 'nx.json', {
        $schema: './node_modules/nx/schemas/nx-schema.json',
        plugins: ['@nx-devkit/typescript'],
      })
      return
    }
    const errors: NonNullable<Parameters<typeof parse>[1]> = []
    const nxJson = parse(raw, errors, { allowTrailingComma: true }) as Record<string, unknown>
    if (errors.length > 0) {
      throw new Error(
        `Failed to parse nx.json: ${errors.map((e) => printParseErrorCode(e.error)).join(', ')}`,
      )
    }
    const plugins = Array.isArray(nxJson.plugins) ? (nxJson.plugins as unknown[]) : []
    const hasPreset = plugins.some(
      (entry) =>
        (typeof entry === 'string' && entry === '@nx-devkit/typescript') ||
        (Array.isArray(entry) && entry[0] === '@nx-devkit/typescript') ||
        (typeof entry === 'object' &&
          entry !== null &&
          !Array.isArray(entry) &&
          (entry as { plugin?: string }).plugin === '@nx-devkit/typescript'),
    )
    if (!hasPreset) {
      // Remove any standalone @nx-devkit/* entries
      const filtered = plugins.filter((entry) => {
        const name = typeof entry === 'string' ? entry : (entry as { plugin?: string }).plugin
        return !name?.startsWith('@nx-devkit/')
      })
      filtered.push('@nx-devkit/typescript')
      nxJson.plugins = filtered
      // Use jsonc-parser modify to preserve formatting and comments
      // Detect formatting from raw content
      const eol = raw.includes('\r\n') ? '\r\n' : '\n'
      const indentMatch = raw.match(/^\s*/)
      const indent = indentMatch ? indentMatch[0].length : 2
      const edits = modify(raw, ['plugins'], filtered, {
        formattingOptions: { insertSpaces: true, tabSize: indent, eol },
      })
      tree.write('nx.json', applyEdits(raw, edits))
    }
  }
}

function getPathAliasPrefix(pkgName: string): string {
  // For scoped packages like @scope/name, use @scope as prefix
  // For unscoped packages like name, use @name as prefix
  if (pkgName.startsWith('@')) {
    const scopeEnd = pkgName.indexOf('/')
    if (scopeEnd > 0) {
      return pkgName.slice(0, scopeEnd)
    }
  }
  return `@${pkgName}`
}

function createPackageStructure(
  tree: Tree,
  packageDir: string,
  pkgName: string,
  options: Required<Omit<NxTypescriptMonorepoOptions, 'name'>>,
): void {
  const pkgPath = `${packageDir}/${pkgName}`

  // package.json
  const packageJson = {
    name: pkgName,
    version: '0.0.0',
    private: true,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        default: './dist/index.js',
      },
    },
    scripts: {
      build: 'nx build',
      'build:watch': 'nx build:watch',
      typecheck: 'nx typecheck',
      test: 'nx test',
      lint: 'nx lint',
      format: 'nx format',
      'format:check': 'nx format-check',
    },
    devDependencies: {},
  }
  writeJson(tree, `${pkgPath}/package.json`, packageJson)

  // tsconfig.json - compute extends path based on package depth
  const depth = pkgName.split('/').length
  const extendsPath = `${'../'.repeat(depth + 1)}tsconfig.base.json`
  const tsconfigJson = {
    extends: extendsPath,
    compilerOptions: {
      rootDir: '.',
      outDir: 'dist',
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      tsBuildInfoFile: 'dist/tsconfig.tsbuildinfo',
    },
    include: ['src/**/*', '*.config.*', '*.config.ts'],
    exclude: ['node_modules', 'dist'],
  }
  writeJson(tree, `${pkgPath}/tsconfig.json`, tsconfigJson)

  // src/index.ts
  const sourceFilePath = `${pkgPath}/src/index.ts`
  let sourceCreated = false
  if (!tree.exists(sourceFilePath)) {
    tree.write(
      sourceFilePath,
      `export function hello(): string {
  return 'Hello from ${pkgName}!'
}
`,
    )
    sourceCreated = true
  }

  // vitest.config.ts
  if (options.test && !options.nativeTest) {
    const vitestConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    environment: 'node',
  },
})
`
    tree.write(`${pkgPath}/vitest.config.ts`, vitestConfig)
  }

  // .oxlintrc.json
  if (options.lint) {
    const oxlintrc = {
      $schema: 'https://oxc.rs/schemas/oxlintrc.json',
      plugins: ['oxc'],
      rules: {},
    }
    writeJson(tree, `${pkgPath}/.oxlintrc.json`, oxlintrc)
  }

  // biome.json
  if (options.format) {
    const biomeConfig = {
      $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
      formatter: {
        enabled: true,
        indentStyle: 'space',
        indentWidth: 2,
      },
      linter: {
        enabled: true,
        rules: {
          recommended: true,
        },
      },
      javascript: {
        formatter: {
          quoteStyle: 'single',
          trailingCommas: 'es5',
          semicolons: 'always',
        },
      },
    }
    writeJson(tree, `${pkgPath}/biome.json`, biomeConfig)
  }

  // tsdown.config.ts - only write when build is enabled
  if (options.build) {
    const tsdownConfig = `import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'node',
  clean: true,
})
`
    tree.write(`${pkgPath}/tsdown.config.ts`, tsdownConfig)
  }

  // Test file - create only when source file was created or already exists
  // (don't create a test that imports from a missing source)
  const testFilePath = `${pkgPath}/src/index.test.ts`
  if (options.test && sourceCreated) {
    if (!tree.exists(testFilePath)) {
      if (options.nativeTest) {
        // Native Node test runner - use assert from node:assert/strict
        tree.write(
          testFilePath,
          `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hello } from './index.js'

test('hello returns greeting', () => {
  assert.strictEqual(hello(), 'Hello from ${pkgName}!')
})
`,
        )
      } else {
        // Vitest test file
        tree.write(
          testFilePath,
          `import { test, expect } from 'vitest'
import { hello } from './index.js'

test('hello returns greeting', () => {
  expect(hello()).toBe('Hello from ${pkgName}!')
})
`,
        )
      }
    }
  }
}

function getMissingDevDeps(
  tree: Tree,
  options: Required<Omit<NxTypescriptMonorepoOptions, 'name'>>,
): Record<string, string> {
  const pkg = readJson(tree, 'package.json') ?? {}
  const existing = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  }

  const needed: Record<string, string> = {}

  // Always need typescript and @typescript/native-preview for typecheck
  if (!('typescript' in existing)) needed.typescript = DEP_VERSIONS.typescript
  if (!('@typescript/native-preview' in existing))
    needed['@typescript/native-preview'] = DEP_VERSIONS['@typescript/native-preview']

  if (options.test && !options.nativeTest) {
    if (!('vitest' in existing)) needed.vitest = DEP_VERSIONS.vitest
  }
  if (options.lint) {
    if (!('oxlint' in existing)) needed.oxlint = DEP_VERSIONS.oxlint
  }
  if (options.format) {
    if (!('@biomejs/biome' in existing)) needed['@biomejs/biome'] = DEP_VERSIONS['@biomejs/biome']
  }
  if (options.build) {
    if (!('tsdown' in existing)) needed.tsdown = DEP_VERSIONS.tsdown
  }

  return needed
}

function printMonorepoSummary(
  pkgName: string,
  packageDir: string,
  installedDeps: Record<string, string>,
  packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn',
  options: Required<Omit<NxTypescriptMonorepoOptions, 'name'>>,
): void {
  console.log('')
  console.log('✅ Monorepo created!')
  console.log('')
  console.log('Structure:')
  console.log(`  .`)
  console.log(`  ├── nx.json`)
  console.log(`  ├── package.json`)
  console.log(`  ├── tsconfig.base.json`)
  console.log(`  └── ${packageDir}/`)
  console.log(`      └── ${pkgName}/`)
  console.log(`          ├── package.json`)
  console.log(`          ├── tsconfig.json`)
  console.log(`          ├── src/index.ts`)
  if (options.test && !options.nativeTest) console.log(`          ├── vitest.config.ts`)
  if (options.lint) console.log(`          ├── .oxlintrc.json`)
  if (options.format) console.log(`          ├── biome.json`)
  if (options.build) console.log(`          ├── tsdown.config.ts`)
  console.log('')
  console.log('The @nx-devkit/typescript preset is registered in nx.json.')
  console.log('Targets are inferred from config files — no project.json needed.')
  console.log('')
  console.log('Available targets for the package:')
  const targets: string[] = ['typecheck']
  if (options.test) {
    if (options.nativeTest) {
      targets.push('test')
    } else {
      targets.push('test', 'test:watch', 'test:coverage')
    }
  }
  if (options.lint) targets.push('lint')
  if (options.format) targets.push('format', 'format-check')
  if (options.build) targets.push('build', 'build:watch')
  console.log(`  ${packageDir}/${pkgName} → ${targets.join(', ')}`)
  console.log('')

  if (Object.keys(installedDeps).length > 0) {
    console.log('Added devDependencies to root package.json:')
    for (const [name, version] of Object.entries(installedDeps)) {
      console.log(`  ${name}: ${version}`)
    }
    const installDepsCmd =
      packageManager === 'bun'
        ? 'bun install'
        : packageManager === 'pnpm'
          ? 'pnpm install'
          : packageManager === 'yarn'
            ? 'yarn install'
            : 'npm install'
    console.log(`Run \`${installDepsCmd}\` to install them.`)
    console.log('')
  }

  console.log('Next steps:')
  console.log(`  1. cd ${packageDir}/${pkgName}`)
  console.log(`  2. nx typecheck   # or nx test, nx lint, nx build, etc.`)
  console.log('')
  console.log('To add another package:')
  console.log(`  nx g @nx-devkit/typescript:package <name>`)
}

export async function monorepoGenerator(
  tree: Tree,
  options: NxTypescriptMonorepoOptions,
): Promise<GeneratorCallback> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options }
  const { name, packageDir, skipInstall, packageManager } = mergedOptions

  // Validate name at entry
  if (!/^(@[a-z0-9-~][a-z0-9-~._]*\/)?[a-z0-9-~][a-z0-9-~._]*$/.test(name)) {
    throw new Error(
      `Invalid package name: "${name}". Must be a valid npm package name (e.g., "my-pkg" or "@scope/my-pkg").`,
    )
  }

  // 1. Ensure root package.json with workspace config
  ensureRootPackageJson(tree, name, packageDir)

  // 2. Ensure nx.json with preset
  ensureNxJson(tree)

  // 3. Create tsconfig.base.json if not exists
  if (!tree.exists('tsconfig.base.json')) {
    const pathAliasPrefix = getPathAliasPrefix(name)
    // For scoped packages, include scope directory in path mapping
    // e.g., @my-org/my-pkg -> packages/@my-org/*/src
    const scopeDir = name.startsWith('@') ? name.slice(0, name.indexOf('/')) : ''
    const pathTarget = scopeDir ? `${packageDir}/${scopeDir}/*/src` : `${packageDir}/*/src`
    const tsconfigBase = {
      compilerOptions: {
        target: 'ES2024',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2024'],
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        baseUrl: '.',
        paths: {
          [`${pathAliasPrefix}/*`]: [pathTarget],
        },
      },
    }
    writeJson(tree, 'tsconfig.base.json', tsconfigBase)
  }

  // 4. Create first package structure
  createPackageStructure(tree, packageDir, name, mergedOptions)

  // 5. Install missing peer deps
  let installCallback: GeneratorCallback = () => {}
  let installedDeps: Record<string, string> = {}

  if (!skipInstall) {
    installedDeps = getMissingDevDeps(tree, mergedOptions)
    if (Object.keys(installedDeps).length > 0) {
      installCallback = addDependenciesToPackageJson(tree, {}, installedDeps)
    }
  }

  // 6. Print summary with installed deps
  printMonorepoSummary(name, packageDir, installedDeps, packageManager, mergedOptions)

  await formatFiles(tree)

  return () => installCallback()
}

export default monorepoGenerator
