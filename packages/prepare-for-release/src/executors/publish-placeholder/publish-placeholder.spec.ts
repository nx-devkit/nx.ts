import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state: {
  calls: Array<{ command: string; args: string[] }>
  responses: Map<string, { status: number; stdout: string; stderr: string }>
} = {
  calls: [],
  responses: new Map(),
}

vi.mock('node:child_process', () => ({
  spawnSync: (command: string, args: string[] = [], _options?: unknown) => {
    state.calls.push({ command, args })
    const key = `${command} ${args.join(' ')}`
    for (const [pattern, response] of state.responses.entries()) {
      if (key.includes(pattern)) return response
    }
    return { status: 0, stdout: '', stderr: '' }
  },
}))

const { publishPlaceholderExecutor } = await import('./executor.js')

import type { NxPrepareForReleaseOptions } from './executor.js'

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'nx-prepare-for-release-'))
}

function makePackage(root: string, name: string, version = '0.0.0'): string {
  const pkgRoot = join(root, 'packages', name.replace('@nx-devkit/', ''))
  mkdirSync(pkgRoot, { recursive: true })
  writeFileSync(
    join(pkgRoot, 'package.json'),
    JSON.stringify({ name, version, license: 'MIT' }, null, 2),
  )
  writeFileSync(join(pkgRoot, 'index.js'), 'module.exports = {}\n')
  return pkgRoot
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

describe('publishPlaceholderExecutor', () => {
  let workspace: string
  let originalCwd: string

  beforeEach(() => {
    workspace = makeWorkspace()
    originalCwd = process.cwd()
    process.chdir(workspace)
    state.calls.length = 0
    state.responses.clear()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workspace, { recursive: true, force: true })
  })

  it('publishes a placeholder tarball when package is not yet on the registry', async () => {
    const pkgRoot = makePackage(workspace, '@nx-devkit/prepare-for-release', '0.0.0')
    const pkgJsonPath = join(pkgRoot, 'package.json')
    const originalBytes = readFileSync(pkgJsonPath)

    state.responses.set('npm view', { status: 1, stdout: '', stderr: 'E404' })
    state.responses.set('npm pack', {
      status: 0,
      stdout: join(workspace, 'nx-devkit-prepare-for-release-0.0.0.tgz'),
      stderr: '',
    })
    state.responses.set('npm publish', {
      status: 0,
      stdout: '+ @nx-devkit/prepare-for-release@0.0.0',
      stderr: '',
    })
    writeFileSync(join(workspace, 'nx-devkit-prepare-for-release-0.0.0.tgz'), 'fake-tarball-bytes')

    const options: NxPrepareForReleaseOptions = { dryRun: false }
    const result = await publishPlaceholderExecutor({ workspaceRoot: workspace, options })

    expect(result.published).toEqual(['@nx-devkit/prepare-for-release'])
    expect(result.skipped).toEqual([])

    const viewCall = state.calls.find((c) => c.args[0] === 'view')
    expect(viewCall).toBeDefined()
    expect(viewCall?.args).toContain('@nx-devkit/prepare-for-release')
    expect(viewCall?.args).toContain('version')

    const publishCall = state.calls.find((c) => c.args[0] === 'publish')
    expect(publishCall).toBeDefined()
    expect(publishCall?.args[1]).toMatch(/\.tgz/)
    expect(publishCall?.args).toContain('--access')
    expect(publishCall?.args).toContain('public')
    expect(publishCall?.args).toContain('--tag')
    expect(publishCall?.args).toContain('placeholder')

    const afterBytes = readFileSync(pkgJsonPath)
    expect(Buffer.compare(originalBytes, afterBytes)).toBe(0)

    const afterParsed = readJson(pkgJsonPath)
    expect(afterParsed.version).toBe('0.0.0')
    expect(afterParsed.publishConfig).toBeUndefined()
  })

  it('skips a package that is already published on the registry', async () => {
    makePackage(workspace, '@nx-devkit/prepare-for-release', '0.0.0')
    state.responses.set('npm view', { status: 0, stdout: '0.5.0', stderr: '' })

    const result = await publishPlaceholderExecutor({ workspaceRoot: workspace, options: {} })

    expect(result.published).toEqual([])
    expect(result.skipped).toEqual(['@nx-devkit/prepare-for-release'])

    const publishCall = state.calls.find((c) => c.args[0] === 'publish')
    expect(publishCall).toBeUndefined()
    const packCall = state.calls.find((c) => c.args[0] === 'pack')
    expect(packCall).toBeUndefined()
  })

  it('emits trust commands so the user can run `npm trust github` against each placeholder', async () => {
    makePackage(workspace, '@nx-devkit/prepare-for-release', '0.0.0')
    state.responses.set('npm view', { status: 1, stdout: '', stderr: 'E404' })
    state.responses.set('npm pack', {
      status: 0,
      stdout: join(workspace, 'nx-devkit-prepare-for-release-0.0.0.tgz'),
      stderr: '',
    })
    state.responses.set('npm publish', { status: 0, stdout: 'ok', stderr: '' })
    writeFileSync(join(workspace, 'nx-devkit-prepare-for-release-0.0.0.tgz'), 'fake-tarball-bytes')

    const result = await publishPlaceholderExecutor({ workspaceRoot: workspace, options: {} })

    expect(result.trustCommands.length).toBeGreaterThanOrEqual(1)
    expect(result.trustCommands[0]).toContain('npm trust github')
    expect(result.trustCommands[0]).toContain('--file release.yml')
    expect(result.trustCommands[0]).toContain('--repo ThePlenkov/nx.ts')
    expect(result.trustCommands[0]).toContain('--allow-publish')
  })

  it('dryRun: true does not call npm publish or npm pack', async () => {
    makePackage(workspace, '@nx-devkit/prepare-for-release', '0.0.0')
    state.responses.set('npm view', { status: 1, stdout: '', stderr: 'E404' })

    const result = await publishPlaceholderExecutor({
      workspaceRoot: workspace,
      options: { dryRun: true },
    })

    expect(result.published).toEqual(['@nx-devkit/prepare-for-release'])
    const publishCall = state.calls.find((c) => c.args[0] === 'publish')
    expect(publishCall).toBeUndefined()
    const packCall = state.calls.find((c) => c.args[0] === 'pack')
    expect(packCall).toBeUndefined()
  })

  it('honors a custom placeholderVersion and placeholderTag', async () => {
    const pkgRoot = makePackage(workspace, '@nx-devkit/prepare-for-release', '1.2.3')
    const originalBytes = readFileSync(join(pkgRoot, 'package.json'))
    state.responses.set('npm view', { status: 1, stdout: '', stderr: 'E404' })
    state.responses.set('npm pack', {
      status: 0,
      stdout: join(workspace, 'nx-devkit-prepare-for-release-1.2.3.tgz'),
      stderr: '',
    })
    state.responses.set('npm publish', { status: 0, stdout: 'ok', stderr: '' })
    writeFileSync(join(workspace, 'nx-devkit-prepare-for-release-1.2.3.tgz'), 'fake-tarball-bytes')

    const result = await publishPlaceholderExecutor({
      workspaceRoot: workspace,
      options: { placeholderTag: 'alpha', placeholderVersion: '0.0.1' },
    })

    expect(result.published).toEqual(['@nx-devkit/prepare-for-release'])
    const afterBytes = readFileSync(join(pkgRoot, 'package.json'))
    expect(Buffer.compare(originalBytes, afterBytes)).toBe(0)
  })
})
