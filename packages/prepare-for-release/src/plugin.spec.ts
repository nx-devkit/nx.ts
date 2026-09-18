import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNodesV2, isReleaseBootstrapProject } from './plugin.ts'

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'nx-prepare-plugin-'))
}

describe('isReleaseBootstrapProject', () => {
  let workspace: string
  beforeEach(() => {
    workspace = makeWorkspace()
  })
  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true })
  })

  it('returns true for a project.json referencing the publish-placeholder executor', () => {
    const toolsDir = join(workspace, 'tools')
    mkdirSync(toolsDir, { recursive: true })
    writeFileSync(
      join(toolsDir, 'project.json'),
      JSON.stringify({
        targets: {
          'prepare-for-release': { executor: '@nx-devkit/prepare-for-release:publish-placeholder' },
        },
      }),
    )
    expect(isReleaseBootstrapProject('tools/project.json', workspace)).toBe(true)
  })

  it('returns false for a regular project.json', () => {
    const libDir = join(workspace, 'packages/lib')
    mkdirSync(libDir, { recursive: true })
    writeFileSync(
      join(libDir, 'project.json'),
      JSON.stringify({ targets: { build: { executor: 'nx:run-commands' } } }),
    )
    expect(isReleaseBootstrapProject('packages/lib/project.json', workspace)).toBe(false)
  })
})

describe('createNodesV2', () => {
  let workspace: string
  beforeEach(() => {
    workspace = makeWorkspace()
  })
  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true })
  })

  it('infers a prepare-for-release target only on the tools project', () => {
    const toolsDir = join(workspace, 'tools')
    mkdirSync(toolsDir, { recursive: true })
    writeFileSync(
      join(toolsDir, 'project.json'),
      JSON.stringify({
        targets: {
          'prepare-for-release': { executor: '@nx-devkit/prepare-for-release:publish-placeholder' },
        },
      }),
    )
    const libDir = join(workspace, 'packages/lib')
    mkdirSync(libDir, { recursive: true })
    writeFileSync(
      join(libDir, 'project.json'),
      JSON.stringify({ targets: { build: { executor: 'nx:run-commands' } } }),
    )

    const result = createNodesV2[1](
      ['tools/project.json', 'packages/lib/project.json'],
      {},
      { nxJsonConfiguration: {}, workspaceRoot: workspace },
    )

    const roots = (result as (readonly [string, { projects: Record<string, unknown> }])[]).flatMap(
      ([_file, body]) => Object.keys(body.projects),
    )
    expect(roots).toContain('tools')
    expect(roots).not.toContain('packages/lib')
  })

  it('respects a custom targetName plugin option', () => {
    const toolsDir = join(workspace, 'tools')
    mkdirSync(toolsDir, { recursive: true })
    writeFileSync(
      join(toolsDir, 'project.json'),
      JSON.stringify({
        targets: {
          'release-bootstrap': { executor: '@nx-devkit/prepare-for-release:publish-placeholder' },
        },
      }),
    )

    const result = createNodesV2[1](
      ['tools/project.json'],
      { targetName: 'release-bootstrap' },
      { nxJsonConfiguration: {}, workspaceRoot: workspace },
    )

    const projects = (
      result as (readonly [
        string,
        { projects: Record<string, { targets?: Record<string, unknown> }> },
      ])[]
    ).map(([_file, body]) => body.projects)[0]
    expect(Object.keys(projects.tools.targets ?? {})).toEqual(['release-bootstrap'])
  })

  it('infers a prepare-for-release target on every non-private package.json', () => {
    const libDir = join(workspace, 'packages/lib')
    mkdirSync(libDir, { recursive: true })
    writeFileSync(
      join(libDir, 'package.json'),
      JSON.stringify({ name: '@acme/lib', version: '1.0.0', private: false }),
    )

    const result = createNodesV2[1](
      ['packages/lib/package.json'],
      {},
      { nxJsonConfiguration: {}, workspaceRoot: workspace },
    )

    const projects = (
      result as (readonly [
        string,
        { projects: Record<string, { targets?: Record<string, { options?: unknown }> }> },
      ])[]
    ).map(([_file, body]) => body.projects)[0]
    const target = projects['packages/lib'].targets?.['prepare-for-release']
    expect(target).toBeDefined()
    expect(target?.options).toEqual({ packageJson: 'packages/lib/package.json' })
  })

  it('skips private and root package.json files', () => {
    const privDir = join(workspace, 'packages/internal')
    mkdirSync(privDir, { recursive: true })
    writeFileSync(
      join(privDir, 'package.json'),
      JSON.stringify({ name: '@acme/internal', private: true }),
    )
    writeFileSync(
      join(workspace, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' }),
    )

    const result = createNodesV2[1](
      ['package.json', 'packages/internal/package.json'],
      {},
      { nxJsonConfiguration: {}, workspaceRoot: workspace },
    )

    expect(result).toEqual([])
  })

  it('skips package.json files matched by the exclude option', () => {
    const fixDir = join(workspace, 'fixtures/demo')
    mkdirSync(fixDir, { recursive: true })
    writeFileSync(
      join(fixDir, 'package.json'),
      JSON.stringify({ name: '@acme/fixture', version: '0.0.0' }),
    )
    const libDir = join(workspace, 'packages/lib')
    mkdirSync(libDir, { recursive: true })
    writeFileSync(
      join(libDir, 'package.json'),
      JSON.stringify({ name: '@acme/lib', version: '1.0.0' }),
    )

    const result = createNodesV2[1](
      ['fixtures/demo/package.json', 'packages/lib/package.json'],
      { exclude: ['fixtures'] },
      { nxJsonConfiguration: {}, workspaceRoot: workspace },
    )

    const roots = (result as (readonly [string, { projects: Record<string, unknown> }])[]).flatMap(
      ([_file, body]) => Object.keys(body.projects),
    )
    expect(roots).toEqual(['packages/lib'])
  })

  it('suppresses the legacy tools target when per-package targets exist', () => {
    const toolsDir = join(workspace, 'tools')
    mkdirSync(toolsDir, { recursive: true })
    writeFileSync(
      join(toolsDir, 'project.json'),
      JSON.stringify({
        targets: {
          'prepare-for-release': { executor: '@nx-devkit/prepare-for-release:publish-placeholder' },
        },
      }),
    )
    const libDir = join(workspace, 'packages/lib')
    mkdirSync(libDir, { recursive: true })
    writeFileSync(
      join(libDir, 'package.json'),
      JSON.stringify({ name: '@acme/lib', version: '1.0.0' }),
    )

    const result = createNodesV2[1](
      ['tools/project.json', 'packages/lib/package.json'],
      {},
      { nxJsonConfiguration: {}, workspaceRoot: workspace },
    )

    const roots = (result as (readonly [string, { projects: Record<string, unknown> }])[]).flatMap(
      ([_file, body]) => Object.keys(body.projects),
    )
    expect(roots).toEqual(['packages/lib'])
  })

  it('keeps tools-only mode when packageTargets is false', () => {
    const toolsDir = join(workspace, 'tools')
    mkdirSync(toolsDir, { recursive: true })
    writeFileSync(
      join(toolsDir, 'project.json'),
      JSON.stringify({
        targets: {
          'prepare-for-release': { executor: '@nx-devkit/prepare-for-release:publish-placeholder' },
        },
      }),
    )
    const libDir = join(workspace, 'packages/lib')
    mkdirSync(libDir, { recursive: true })
    writeFileSync(
      join(libDir, 'package.json'),
      JSON.stringify({ name: '@acme/lib', version: '1.0.0' }),
    )

    const result = createNodesV2[1](
      ['tools/project.json', 'packages/lib/package.json'],
      { packageTargets: false },
      { nxJsonConfiguration: {}, workspaceRoot: workspace },
    )

    const roots = (result as (readonly [string, { projects: Record<string, unknown> }])[]).flatMap(
      ([_file, body]) => Object.keys(body.projects),
    )
    expect(roots).toEqual(['tools'])
  })

  it('limits inference to a custom toolsProject when provided', () => {
    const toolsDir = join(workspace, 'tools')
    mkdirSync(toolsDir, { recursive: true })
    writeFileSync(
      join(toolsDir, 'project.json'),
      JSON.stringify({
        targets: {
          'prepare-for-release': { executor: '@nx-devkit/prepare-for-release:publish-placeholder' },
        },
      }),
    )
    const otherDir = join(workspace, 'packages/bootstrap')
    mkdirSync(otherDir, { recursive: true })
    writeFileSync(
      join(otherDir, 'project.json'),
      JSON.stringify({
        targets: {
          'prepare-for-release': { executor: '@nx-devkit/prepare-for-release:publish-placeholder' },
        },
      }),
    )

    const result = createNodesV2[1](
      ['tools/project.json', 'packages/bootstrap/project.json'],
      { toolsProject: 'packages/bootstrap' },
      { nxJsonConfiguration: {}, workspaceRoot: workspace },
    )

    const roots = (result as (readonly [string, { projects: Record<string, unknown> }])[]).flatMap(
      ([_file, body]) => Object.keys(body.projects),
    )
    expect(roots).toEqual(['packages/bootstrap'])
  })
})
