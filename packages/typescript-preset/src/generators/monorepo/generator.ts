import {
  type GeneratorCallback,
  type Tree,
  formatFiles,
  addDependenciesToPackageJson,
} from '@nx/devkit'

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
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    throw new Error(`Failed to parse ${path}`, { cause: error })
  }
}

function writeJson(tree: Tree, path: string, value: unknown): void {
  tree.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

function ensureRootPackageJson(tree: Tree, workspaceName: string): void {
  if (!tree.exists('package.json')) {
    writeJson(tree, 'package.json', {
      name: workspaceName,
      version: '0.0.0',
      private: true,
      workspaces: ['packages/*'],
      packageManager: 'bun@latest',
    })
  } else {
    const pkg = readJson(tree, 'package.json') ?? {}
    const workspaces = (pkg.workspaces as string[]) ?? []
    if (!workspaces.includes('packages/*')) {
      pkg.workspaces = [...workspaces, 'packages/*']
      writeJson(tree, 'package.json', pkg)
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
    const nxJson = readJson(tree, 'nx.json') ?? {}
    const plugins = Array.isArray(nxJson.plugins) ? (nxJson.plugins as unknown[]) : []
    const hasPreset = plugins.some(
      (entry) =>
        (typeof entry === 'string' && entry === '@nx-devkit/typescript') ||
        (typeof entry === 'object' &&
          entry !== null &&
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
      writeJson(tree, 'nx.json', nxJson)
    }
  }
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

  // tsconfig.json
  const tsconfigJson = {
    extends: '../../tsconfig.base.json',
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
  if (!tree.exists(`${pkgPath}/src`)) {
    tree.write(
      `${pkgPath}/src/index.ts`,
      `export function hello(): string {
  return 'Hello from ${pkgName}!'
}
`,
    )
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

  // tsdown.config.ts
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

  // Native test file if no vitest
  if (options.test && options.nativeTest) {
    if (!tree.exists(`${pkgPath}/src`)) {
      tree.write(
        `${pkgPath}/src/index.test.ts`,
        `import { test, expect } from 'node:test'
import { hello } from './index.js'

test('hello returns greeting', () => {
  expect(hello()).toBe('Hello from ${pkgName}!')
})
`,
      )
    }
  } else if (options.test) {
    // Vitest test file
    if (!tree.exists(`${pkgPath}/src`)) {
      tree.write(
        `${pkgPath}/src/index.test.ts`,
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

  // 1. Ensure root package.json with workspace config
  ensureRootPackageJson(tree, name)

  // 2. Ensure nx.json with preset
  ensureNxJson(tree)

  // 3. Create tsconfig.base.json if not exists
  if (!tree.exists('tsconfig.base.json')) {
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
          [`@${name}/*`]: [`${packageDir}/*/src`],
        },
      },
    }
    writeJson(tree, 'tsconfig.base.json', tsconfigBase)
  }

  // 4. Create first package structure
  createPackageStructure(tree, packageDir, name, mergedOptions)

  // 5. Install missing peer deps
  let installCallback: GeneratorCallback = () => {}

  if (!skipInstall) {
    const installedDeps = getMissingDevDeps(tree, mergedOptions)
    if (Object.keys(installedDeps).length > 0) {
      installCallback = addDependenciesToPackageJson(tree, {}, installedDeps)
    }
  }

  // 6. Print summary
  printMonorepoSummary(name, packageDir, {}, packageManager, mergedOptions)

  await formatFiles(tree)

  return () => installCallback()
}

export default monorepoGenerator
