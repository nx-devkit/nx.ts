import { describe, expect, it, vi } from 'vitest'
import type { Tree } from '@nx/devkit'
import { packageGenerator } from '../src/generators/package/generator.js'

function createTree(files: Record<string, string> = {}): {
  tree: Tree
  files: Map<string, string>
} {
  const fileMap = new Map<string, string>(Object.entries(files))

  const tree: Tree = {
    exists: (path: string) =>
      fileMap.has(path) || Array.from(fileMap.keys()).some((key) => key.startsWith(`${path}/`)),
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

async function capturedSummary<O>(
  generator: (tree: Tree, options: O) => Promise<unknown>,
  tree: Tree,
  options: O,
): Promise<string> {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await generator(tree, options)
    return consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
  } finally {
    consoleSpy.mockRestore()
  }
}

describe('packageGenerator', () => {
  describe('basic structure', () => {
    it('creates package in packages/ by default', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      expect(files.has('packages/my-pkg/package.json')).toBe(true)
      expect(files.has('packages/my-pkg/tsconfig.json')).toBe(true)
      expect(files.has('packages/my-pkg/src/index.ts')).toBe(true)
    })

    it('creates package.json with proper exports', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      const pkg = readJson(files, 'packages/my-pkg/package.json')
      expect(pkg.name).toBe('my-pkg')
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
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      const tsconfig = readJson(files, 'packages/my-pkg/tsconfig.json')
      expect(tsconfig.extends).toBe('../../tsconfig.base.json')
      expect(tsconfig.compilerOptions.outDir).toBe('dist')
    })

    it('creates src/index.ts with hello function', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      const content = files.get('packages/my-pkg/src/index.ts')
      expect(content).toContain('export function hello(): string')
      expect(content).toContain('Hello from my-pkg!')
    })
  })

  describe('config files', () => {
    it('creates vitest.config.ts by default', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      expect(files.has('packages/my-pkg/vitest.config.ts')).toBe(true)
    })

    it('creates .oxlintrc.json by default', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      expect(files.has('packages/my-pkg/.oxlintrc.json')).toBe(true)
    })

    it('creates biome.json by default', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      expect(files.has('packages/my-pkg/biome.json')).toBe(true)
    })

    it('creates tsdown.config.ts by default', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      expect(files.has('packages/my-pkg/tsdown.config.ts')).toBe(true)
    })

    it('skips vitest when test:false', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg', test: false })

      expect(files.has('packages/my-pkg/vitest.config.ts')).toBe(false)
    })

    it('creates native test file when nativeTest:true', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg', nativeTest: true })

      expect(files.has('packages/my-pkg/src/index.test.ts')).toBe(true)
      const content = files.get('packages/my-pkg/src/index.test.ts') ?? ''
      expect(content).toContain("import { test } from 'node:test'")
      expect(content).toContain("import assert from 'node:assert/strict'")
      expect(content).toContain('assert.strictEqual')
    })
  })

  describe('directory option', () => {
    it('uses apps/ when directory:apps', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['apps/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-app', directory: 'apps' })

      expect(files.has('apps/my-app/package.json')).toBe(true)
      expect(files.has('packages/my-app/package.json')).toBe(false)
    })

    it('uses libs/ when directory:libs', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['libs/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-lib', directory: 'libs' })

      expect(files.has('libs/my-lib/package.json')).toBe(true)
      expect(files.has('packages/my-lib/package.json')).toBe(false)
    })
  })

  describe('parent option', () => {
    it('adds parent as workspace dependency', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
        'packages/parent/package.json': JSON.stringify({ name: 'parent', version: '0.0.0' }),
      })

      await packageGenerator(tree, { name: 'child', parent: 'parent' })

      const pkg = readJson(files, 'packages/child/package.json')
      expect(pkg.dependencies).toEqual({ parent: 'workspace:*' })
    })

    it('throws when parent does not exist', async () => {
      const { tree } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await expect(
        packageGenerator(tree, { name: 'child', parent: 'nonexistent' }),
      ).rejects.toThrow('Parent package "nonexistent" not found in workspace.')
    })
  })

  describe('dependency installation', () => {
    it('adds missing devDependencies to root package.json', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg', skipInstall: false })

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
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg', skipInstall: true })

      const pkg = readJson(files, 'package.json')
      expect(pkg.devDependencies).toBeUndefined()
    })
  })

  describe('preserves existing files', () => {
    it('preserves existing nx.json and adds preset if missing', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx/vite'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      const nxJson = readJson(files, 'nx.json')
      const plugins = nxJson.plugins as unknown[]
      const pluginNames = plugins.map((p) =>
        typeof p === 'string' ? p : (p as { plugin: string }).plugin,
      )
      expect(pluginNames).toContain('@nx/vite')
      expect(pluginNames).toContain('@nx-devkit/typescript')
    })

    it('adds workspaces to existing package.json', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({ name: 'workspace', version: '1.0.0', private: true }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: 'my-pkg' })

      const pkg = readJson(files, 'package.json')
      expect(pkg.workspaces).toContain('packages/*')
      expect(pkg.workspaces).toContain('apps/*')
      expect(pkg.workspaces).toContain('libs/*')
    })
  })

  describe('validation', () => {
    it('throws on invalid package name', async () => {
      const { tree } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await expect(packageGenerator(tree, { name: 'Invalid_Name' })).rejects.toThrow(
        'Invalid package name',
      )
    })

    it('throws when package already exists', async () => {
      const { tree } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
        'packages/existing/package.json': JSON.stringify({ name: 'existing', version: '0.0.0' }),
      })

      await expect(packageGenerator(tree, { name: 'existing' })).rejects.toThrow(
        'Package already exists at packages/existing',
      )
    })
  })

  describe('summary output', () => {
    it('prints package created message', async () => {
      const { tree } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      const output = await capturedSummary(packageGenerator, tree, { name: 'my-pkg' })

      expect(output).toContain('✅ Package "my-pkg" created in packages/!')
      expect(output).toContain('packages/my-pkg')
    })

    it('prints available targets', async () => {
      const { tree } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      const output = await capturedSummary(packageGenerator, tree, { name: 'my-pkg' })

      expect(output).toContain('Available targets:')
      expect(output).toContain('typecheck')
      expect(output).toContain('test')
      expect(output).toContain('lint')
      expect(output).toContain('format')
      expect(output).toContain('build')
    })

    it('prints parent dependency message', async () => {
      const { tree } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
        'packages/parent/package.json': JSON.stringify({ name: 'parent', version: '0.0.0' }),
      })

      const output = await capturedSummary(packageGenerator, tree, {
        name: 'child',
        parent: 'parent',
      })

      expect(output).toContain('Added dependency on parent (workspace:*)')
    })
  })

  describe('scoped package names', () => {
    it('handles scoped package names', async () => {
      const { tree, files } = createTree({
        'package.json': JSON.stringify({
          name: 'workspace',
          private: true,
          workspaces: ['packages/*'],
        }),
        'nx.json': JSON.stringify({ plugins: ['@nx-devkit/typescript'] }),
        'tsconfig.base.json': JSON.stringify({ compilerOptions: {} }),
      })

      await packageGenerator(tree, { name: '@my-org/my-pkg' })

      expect(files.has('packages/@my-org/my-pkg/package.json')).toBe(true)
      const pkg = readJson(files, 'packages/@my-org/my-pkg/package.json')
      expect(pkg.name).toBe('@my-org/my-pkg')
    })
  })
})
