import {
  type GeneratorCallback,
  type Tree,
  formatFiles,
  addDependenciesToPackageJson,
} from '@nx/devkit'
import { parse, modify, applyEdits, printParseErrorCode } from 'jsonc-parser'

export interface NxTypescriptPackageOptions {
  /** Name of the new package. */
  name: string
  /** Directory to create the package in. Default: "packages". */
  directory?: 'packages' | 'apps' | 'libs'
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
  /** Parent package to add as a dependency (for internal deps). */
  parent?: string
}

const DEFAULT_OPTIONS: Required<Omit<NxTypescriptPackageOptions, 'name' | 'parent'>> = {
  directory: 'packages',
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

function readJsonc(tree: Tree, path: string): Record<string, unknown> | null {
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

function getWorkspaceGlobs(): string[] {
  return ['packages/*', 'packages/@*/*', 'apps/*', 'apps/@*/*', 'libs/*', 'libs/@*/*']
}

function ensureRootPackageJson(tree: Tree): void {
  const workspaceGlobs = getWorkspaceGlobs()
  if (!tree.exists('package.json')) {
    writeJson(tree, 'package.json', {
      name: 'workspace',
      version: '0.0.0',
      private: true,
      workspaces: workspaceGlobs,
      packageManager: 'bun@latest',
    })
  } else {
    const raw = tree.read('package.json', 'utf-8')
    if (raw === null || raw.trim() === '') {
      writeJson(tree, 'package.json', {
        name: 'workspace',
        version: '0.0.0',
        private: true,
        workspaces: workspaceGlobs,
        packageManager: 'bun@latest',
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
      // Yarn Classic registers workspaces only from `packages`
      workspaces = [...(existingWorkspaces.packages ?? [])]
    }
    const requiredWorkspaces = [
      'packages/*',
      'packages/@*/*',
      'apps/*',
      'apps/@*/*',
      'libs/*',
      'libs/@*/*',
    ]
    const missing = requiredWorkspaces.filter((ws) => !workspaces.includes(ws))
    if (missing.length > 0) {
      // Use jsonc-parser modify to preserve formatting and comments
      // Use array-element paths to preserve comments inside arrays/objects
      const eol = raw.includes('\r\n') ? '\r\n' : '\n'
      const indentMatch = raw.match(/^\s*/)
      const indent = indentMatch ? indentMatch[0].length : 2
      const formattingOptions = { insertSpaces: true, tabSize: indent, eol }
      let updated = raw
      if (isObjectForm) {
        // For object form, add missing globs to packages array
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
      } else {
        // For array form, add to the end of the array
        for (const [index, glob] of missing.entries()) {
          const edits = modify(updated, ['workspaces', workspaces.length + index], glob, {
            formattingOptions,
          })
          updated = applyEdits(updated, edits)
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

function ensureTsconfigBase(tree: Tree, directory: string, pkgName: string): void {
  if (!tree.exists('tsconfig.base.json')) {
    const pathAliasPrefix = pkgName.startsWith('@')
      ? pkgName.slice(0, pkgName.indexOf('/'))
      : `@${pkgName}`
    // For scoped packages, include scope directory in path mapping
    // e.g., @scope/my-pkg -> packages/@scope/*/src
    const scopeDir = pkgName.startsWith('@') ? pkgName.slice(0, pkgName.indexOf('/')) : ''
    const pathTarget = scopeDir ? `${directory}/${scopeDir}/*/src` : `${directory}/*/src`
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
}

function validatePackageName(name: string): void {
  // Valid npm package name: optional @scope/, then name with lowercase, digits, hyphens, underscores
  if (!/^(@[a-z0-9-~][a-z0-9-~._]*\/)?[a-z0-9-~][a-z0-9-~._]*$/.test(name)) {
    throw new Error(
      `Invalid package name: "${name}". Must be a valid npm package name (e.g., "my-pkg" or "@scope/my-pkg").`,
    )
  }
}

function findParentPackage(tree: Tree, parent: string): string | null {
  // Search in packages/, apps/, libs/ for the parent package
  for (const dir of ['packages', 'apps', 'libs']) {
    const parentPath = `${dir}/${parent}/package.json`
    if (tree.exists(parentPath)) {
      return parentPath
    }
  }
  return null
}

function createPackageStructure(
  tree: Tree,
  directory: string,
  pkgName: string,
  options: Required<Omit<NxTypescriptPackageOptions, 'name' | 'parent'>> & { parent?: string },
): void {
  const pkgPath = `${directory}/${pkgName}`

  // Check if package already exists
  if (tree.exists(`${pkgPath}/package.json`)) {
    throw new Error(`Package already exists at ${pkgPath}`)
  }

  // package.json
  const packageJson: Record<string, unknown> & { dependencies?: Record<string, string> } = {
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

  // Add parent as dependency if specified
  if (options.parent) {
    packageJson.dependencies = {
      ...packageJson.dependencies,
      [options.parent]: 'workspace:*',
    }
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

  // Test file - create only when source file was created by this generator
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
  options: Required<Omit<NxTypescriptPackageOptions, 'name' | 'parent'>> & { parent?: string },
): Record<string, string> {
  const pkg = readJsonc(tree, 'package.json') ?? {}
  const existing = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  }

  const needed: Record<string, string> = {}

  // Always need typescript and @typescript/native-preview for typecheck (at root)
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

function printPackageSummary(
  pkgName: string,
  directory: string,
  installedDeps: Record<string, string>,
  packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn',
  options: Required<Omit<NxTypescriptPackageOptions, 'name' | 'parent'>> & { parent?: string },
): void {
  console.log('')
  console.log(`✅ Package "${pkgName}" created in ${directory}/!`)
  console.log('')
  console.log('Structure:')
  console.log(`  ${directory}/`)
  console.log(`  └── ${pkgName}/`)
  console.log(`      ├── package.json`)
  console.log(`      ├── tsconfig.json`)
  console.log(`      ├── src/index.ts`)
  if (options.test && !options.nativeTest) console.log(`      ├── vitest.config.ts`)
  if (options.lint) console.log(`      ├── .oxlintrc.json`)
  if (options.format) console.log(`      ├── biome.json`)
  if (options.build) console.log(`      ├── tsdown.config.ts`)
  console.log('')

  console.log('Available targets:')
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
  console.log(`  ${directory}/${pkgName} → ${targets.join(', ')}`)
  console.log('')

  if (options.parent) {
    console.log(`Added dependency on ${options.parent} (workspace:*)`)
    console.log('')
  }

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
  console.log(
    `  nx typecheck ${pkgName}   # or nx test ${pkgName}, nx lint ${pkgName}, nx build ${pkgName}`,
  )
  console.log('')
  console.log('To add another package:')
  console.log(`  nx g @nx-devkit/typescript:package <name>`)
}

export async function packageGenerator(
  tree: Tree,
  options: NxTypescriptPackageOptions,
): Promise<GeneratorCallback> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options }
  const { name, directory, skipInstall, packageManager, parent } = mergedOptions

  validatePackageName(name)

  if (parent) {
    if (!/^(@[a-z0-9-~][a-z0-9-~._]*\/)?[a-z0-9-~][a-z0-9-~._]*$/.test(parent)) {
      throw new Error(`Invalid parent package name: "${parent}". Must be a valid npm package name.`)
    }
  }

  // 1. Ensure root package.json with workspace config
  ensureRootPackageJson(tree)

  // 2. Ensure nx.json with preset
  ensureNxJson(tree)

  // 3. Ensure tsconfig.base.json
  ensureTsconfigBase(tree, directory, name)

  // 4. Verify parent exists if specified
  if (parent) {
    const parentPath = findParentPackage(tree, parent)
    if (!parentPath) {
      throw new Error(`Parent package "${parent}" not found in workspace.`)
    }
  }

  // 5. Create package structure
  createPackageStructure(tree, directory, name, { ...mergedOptions, parent })

  // 6. Install missing peer deps
  let installCallback: GeneratorCallback = () => {}
  let installedDeps: Record<string, string> = {}

  if (!skipInstall) {
    installedDeps = getMissingDevDeps(tree, { ...mergedOptions, parent })
    if (Object.keys(installedDeps).length > 0) {
      installCallback = addDependenciesToPackageJson(tree, {}, installedDeps)
    }
  }

  // 7. Print summary with installed deps
  printPackageSummary(name, directory, installedDeps, packageManager, { ...mergedOptions, parent })

  await formatFiles(tree)

  return () => installCallback()
}

export default packageGenerator
