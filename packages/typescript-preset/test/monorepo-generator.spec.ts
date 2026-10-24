import { describe, expect, it, vi } from 'vitest'
import type { Tree } from '@nx/devkit'
import { monorepoGenerator } from '../src/generators/monorepo/generator.js'

function createTree(files: Record<string, string> = {}): {
  tree: Tree
  files: Map<string, string>
} {
  const fileMap = new Map<string, string>(Object.entries(files))

  const tree: Tree = {
    exists: (path: string) => fileMap.has(path),
    read: (path: string) => fileMap.get(path) ?? null,
    write: (path: string, content: string) => {
      fileMap.set(path, content)
    },
    delete: (path: string) => {
      fileMap.delete(path)
    },
    listChanges: () => [],
    rename: () => {},
    root: '/workspace',
    children: (path: string): string[] => {
      const prefix = path === '' || path === '.' ? '' : `${path}/`
      const children = new Set<string>()
      for (const filePath of fileMap.keys()) {
        if (filePath.startsWith(prefix)) {
          const rest = filePath.slice(prefix.length)
          const firstSlash = rest.indexOf('/')
          if (firstSlash === -1) {
            children.add(rest)
          } else {
            children.add(rest.slice(0, firstSlash))
          }
        }
      }
      return Array.from(children)
    },
    isFile: (path: string): boolean => fileMap.has(path) && !fileMap.has(`${path}/`),
  }

  return { tree, files: fileMap }
}

function readJson(files: Map<string, string>, path: string): Record<string, unknown> {
  return JSON.parse(files.get(path) ?? '{}') as Record<string, unknown>
}

async function capturedSummary(
  generator: (tree: Tree, options: Record<string, unknown>) => Promise<unknown>,
  tree: Tree,
  options: Record<string, unknown>,
): Promise<string> {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await generator(tree, options)
    return consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
  } finally {
    consoleSpy.mockRestore()
  }
}

describe('monorepoGenerator', () => {
  describe('basic structure', () => {
    it('creates root package.json with workspace config', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      expect(files.has('package.json')).toBe(true)
      const pkg = readJson(files, 'package.json')
      expect(pkg.name).toBe('my-monorepo')
      expect(pkg.private).toBe(true)
      expect(pkg.workspaces).toEqual(['packages/*'])
    })

    it('creates nx.json with the preset', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      expect(files.has('nx.json')).toBe(true)
      const nxJson = readJson(files, 'nx.json')
      expect(nxJson.plugins).toContain('@nx-devkit/typescript')
    })

    it('creates tsconfig.base.json', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      expect(files.has('tsconfig.base.json')).toBe(true)
      const tsconfig = readJson(files, 'tsconfig.base.json')
      expect(tsconfig.compilerOptions).toBeDefined()
      expect(tsconfig.compilerOptions.baseUrl).toBe('.')
    })

    it('creates the first package in packages/', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      expect(files.has('packages/my-monorepo/package.json')).toBe(true)
      expect(files.has('packages/my-monorepo/tsconfig.json')).toBe(true)
      expect(files.has('packages/my-monorepo/src/index.ts')).toBe(true)
    })

    it('creates package.json with proper exports', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      const pkg = readJson(files, 'packages/my-monorepo/package.json')
      expect(pkg.name).toBe('my-monorepo')
      expect(pkg.main).toBe('./dist/index.js')
      expect(pkg.types).toBe('./dist/index.d.ts')
      expect(pkg.exports).toEqual({
        '.': {
          types: './dist/index.d.ts',
          default: './dist/index.js',
        },
      })
    })

    it('creates tsconfig.json extending base', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      const tsconfig = readJson(files, 'packages/my-monorepo/tsconfig.json')
      expect(tsconfig.extends).toBe('../../tsconfig.base.json')
      expect(tsconfig.compilerOptions.outDir).toBe('dist')
      expect(tsconfig.compilerOptions.declaration).toBe(true)
    })

    it('creates src/index.ts with hello function', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      const content = files.get('packages/my-monorepo/src/index.ts')
      expect(content).toContain('export function hello(): string')
      expect(content).toContain('Hello from my-monorepo!')
    })
  })

  describe('config files', () => {
    it('creates vitest.config.ts by default', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      expect(files.has('packages/my-monorepo/vitest.config.ts')).toBe(true)
      const content = files.get('packages/my-monorepo/vitest.config.ts') ?? ''
      expect(content).toContain('defineConfig')
      expect(content).toContain('vitest/config')
    })

    it('creates .oxlintrc.json by default', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      expect(files.has('packages/my-monorepo/.oxlintrc.json')).toBe(true)
      const oxlintrc = readJson(files, 'packages/my-monorepo/.oxlintrc.json')
      expect(oxlintrc.plugins).toContain('oxc')
    })

    it('creates biome.json by default', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      expect(files.has('packages/my-monorepo/biome.json')).toBe(true)
      const biome = readJson(files, 'packages/my-monorepo/biome.json')
      expect(biome.formatter.enabled).toBe(true)
      expect(biome.linter.enabled).toBe(true)
    })

    it('creates tsdown.config.ts by default', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      expect(files.has('packages/my-monorepo/tsdown.config.ts')).toBe(true)
      const content = files.get('packages/my-monorepo/tsdown.config.ts') ?? ''
      expect(content).toContain('defineConfig')
      expect(content).toContain('tsdown')
    })

    it('skips vitest when test:false', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo', test: false })

      expect(files.has('packages/my-monorepo/vitest.config.ts')).toBe(false)
    })

    it('skips oxlint when lint:false', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo', lint: false })

      expect(files.has('packages/my-monorepo/.oxlintrc.json')).toBe(false)
    })

    it('skips biome when format:false', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo', format: false })

      expect(files.has('packages/my-monorepo/biome.json')).toBe(false)
    })

    it('skips tsdown when build:false', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo', build: false })

      expect(files.has('packages/my-monorepo/tsdown.config.ts')).toBe(false)
    })

    it('creates native test file when nativeTest:true', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo', nativeTest: true })

      expect(files.has('packages/my-monorepo/src/index.test.ts')).toBe(true)
      const content = files.get('packages/my-monorepo/src/index.test.ts') ?? ''
      expect(content).toContain("import { test, expect } from 'node:test'")
      expect(content).not.toContain('vitest')
    })

    it('creates vitest test file when nativeTest:false (default)', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      expect(files.has('packages/my-monorepo/src/index.test.ts')).toBe(true)
      const content = files.get('packages/my-monorepo/src/index.test.ts') ?? ''
      expect(content).toContain("import { test, expect } from 'vitest'")
    })
  })

  describe('packageDir option', () => {
    it('uses apps/ when packageDir:apps', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo', packageDir: 'apps' })

      expect(files.has('apps/my-monorepo/package.json')).toBe(true)
      expect(files.has('packages/my-monorepo/package.json')).toBe(false)
    })

    it('uses libs/ when packageDir:libs', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo', packageDir: 'libs' })

      expect(files.has('libs/my-monorepo/package.json')).toBe(true)
      expect(files.has('packages/my-monorepo/package.json')).toBe(false)
    })
  })

  describe('dependency installation', () => {
    it('adds missing devDependencies to root package.json', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo', skipInstall: false })

      const pkg = readJson(files, 'package.json')
      const devDeps = pkg.devDependencies as Record<string, string>
      expect(devDeps.typescript).toBeDefined()
      expect(devDeps['@typescript/native-preview']).toBeDefined()
      expect(devDeps.vitest).toBeDefined()
      expect(devDeps.oxlint).toBeDefined()
      expect(devDeps['@biomejs/biome']).toBeDefined()
      expect(devDeps.tsdown).toBeDefined()
    })

    it('skips install when skipInstall:true', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: 'my-monorepo', skipInstall: true })

      const pkg = readJson(files, 'package.json')
      expect(pkg.devDependencies).toBeUndefined()
    })
  })

  describe('preserves existing files', () => {
    it('preserves existing nx.json and adds preset', async () => {
      const { tree, files } = createTree({
        'nx.json': JSON.stringify({
          $schema: './node_modules/nx/schemas/nx-schema.json',
          plugins: ['@nx/vite'],
        }),
      })

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      const nxJson = readJson(files, 'nx.json')
      expect(nxJson.$schema).toBe('./node_modules/nx/schemas/nx-schema.json')
      const plugins = nxJson.plugins as unknown[]
      const pluginNames = plugins.map((p) =>
        typeof p === 'string' ? p : (p as { plugin: string }).plugin,
      )
      expect(pluginNames).toContain('@nx/vite')
      expect(pluginNames).toContain('@nx-devkit/typescript')
    })

    it('preserves existing package.json and adds workspaces', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'existing',
          version: '1.0.0',
          private: true,
          workspaces: [],
        }),
      })

      await monorepoGenerator(tree, { name: 'my-monorepo' })

      const pkg = readJson(files, 'package.json')
      expect(pkg.name).toBe('existing')
      expect(pkg.workspaces).toContain('packages/*')
    })
  })

  describe('summary output', () => {
    it('prints monorepo created message', async () => {
      const { tree } = createTree({})

      const output = await capturedSummary(monorepoGenerator, tree, {
        name: 'my-monorepo',
        skipInstall: true,
      })

      expect(output).toContain('✅ Monorepo created!')
      expect(output).toContain('packages/my-monorepo')
      expect(output).toContain('typecheck')
    })

    it('prints available targets', async () => {
      const { tree } = createTree({})

      const output = await capturedSummary(monorepoGenerator, tree, {
        name: 'my-monorepo',
        skipInstall: true,
      })

      expect(output).toContain('Available targets for the package:')
      expect(output).toContain('typecheck')
      expect(output).toContain('test')
      expect(output).toContain('lint')
      expect(output).toContain('format')
      expect(output).toContain('build')
    })
  })

  describe('scoped package names', () => {
    it('handles scoped package names', async () => {
      const { tree, files } = createTree({})

      await monorepoGenerator(tree, { name: '@my-org/my-monorepo' })

      expect(files.has('packages/@my-org/my-monorepo/package.json')).toBe(true)
      const pkg = readJson(files, 'packages/@my-org/my-monorepo/package.json')
      expect(pkg.name).toBe('@my-org/my-monorepo')
    })
  })
})
