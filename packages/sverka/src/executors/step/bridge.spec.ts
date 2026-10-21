import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DefinitionGraph, StepDefinition } from '@sverka/workflow'
import { describe, expect, it } from 'vitest'
import { collectStepValues, materializeImportedArtifacts, publishStepOutputs } from './bridge.ts'

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-sverka-bridge-'))
  mkdirSync(join(root, '.sverka', 'artifacts', 'ci', 'producer'), { recursive: true })
  writeFileSync(join(root, '.sverka', 'artifacts', 'ci', 'producer', 'report.json'), '{"ok":true}')
  return root
}

function step(overrides: Partial<StepDefinition>): StepDefinition {
  return {
    id: 'ci/consumer',
    runtime: {},
    operations: [],
    inputs: [],
    outputs: [],
    dependencies: [],
    ...overrides,
  } as StepDefinition
}

function graphWith(producer: StepDefinition): DefinitionGraph {
  return {
    project: {
      id: 'demo',
      pipelines: [
        {
          id: 'ci',
          inputs: {},
          entries: [],
          steps: [producer],
          outputs: [],
        },
      ],
    },
  }
}

describe('artifact bridge', () => {
  it('materializes an imported artifact in the project directory', () => {
    const workspace = makeWorkspace()
    const producer = step({
      id: 'ci/producer',
      outputs: [{ name: 'report.json', type: 'artifact', fromStdout: true }],
    })
    const consumer = step({
      operations: [
        {
          kind: 'importArtifact',
          name: 'report.json',
          from: 'ci/producer',
          output: 'report.json',
        },
      ],
    })

    const materialized = materializeImportedArtifacts(consumer, graphWith(producer), workspace)

    expect(materialized).toEqual([join(workspace, 'report.json')])
  })

  it('refuses to materialize an artifact outside the project directory', () => {
    const workspace = makeWorkspace()
    const producer = step({
      id: 'ci/producer',
      outputs: [{ name: 'report.json', type: 'artifact', fromStdout: true }],
    })
    const consumer = step({
      operations: [
        {
          kind: 'importArtifact',
          name: '../../escaped.json',
          from: 'ci/producer',
          output: 'report.json',
        },
      ],
    })

    expect(() => materializeImportedArtifacts(consumer, graphWith(producer), workspace)).toThrow(
      /escapes the project directory/,
    )
  })

  it('refuses to read a producer output outside the project directory', () => {
    const workspace = makeWorkspace()
    const producer = step({
      id: 'ci/producer',
      outputs: [{ name: 'report.json', type: 'artifact', path: '../escaped.json' }],
    })
    const consumer = step({
      operations: [
        {
          kind: 'importArtifact',
          name: 'report.json',
          from: 'ci/producer',
          output: 'report.json',
        },
      ],
    })

    expect(() => materializeImportedArtifacts(consumer, graphWith(producer), workspace)).toThrow(
      /declares no such output/,
    )
  })

  it('does not publish an output outside the project directory', () => {
    const workspace = makeWorkspace()
    const consumer = step({
      operations: [{ kind: 'exportArtifact', name: 'escaped.json', path: '../escaped.json' }],
    })

    const published = publishStepOutputs(consumer, join(workspace, '.tmp'), undefined, workspace)

    expect(published).toEqual([])
  })

  it('publishes a stdout artifact to its stable path', () => {
    const workspace = makeWorkspace()
    const artifactDir = mkdtempSync(join(tmpdir(), 'nx-sverka-art-'))
    const runId = 'run-1'
    mkdirSync(join(artifactDir, runId, 'ci', 'producer'), { recursive: true })
    writeFileSync(join(artifactDir, runId, 'ci', 'producer', 'report.json'), '{"ok":true}')

    const producer = step({
      id: 'ci/producer',
      operations: [
        { kind: 'shell', command: 'true' },
        { kind: 'exportStdout', name: 'report.json' },
      ],
    })

    const published = publishStepOutputs(producer, artifactDir, runId, workspace)

    expect(published).toEqual([
      join(workspace, '.sverka', 'artifacts', 'ci', 'producer', 'report.json'),
    ])
  })

  it('reads a producer value from its stable path', () => {
    const workspace = makeWorkspace()
    mkdirSync(join(workspace, '.sverka', 'artifacts', 'ci', 'producer', 'values'), {
      recursive: true,
    })
    writeFileSync(
      join(workspace, '.sverka', 'artifacts', 'ci', 'producer', 'values', 'version'),
      '1.2.3',
    )

    const producer = step({
      id: 'ci/producer',
      outputs: [{ name: 'version', type: 'string' }],
    })
    const consumer = step({
      operations: [{ kind: 'shell', command: 'echo ${producer.version}' }],
      inputs: [{ kind: 'step', step: 'producer', output: 'version', type: 'string' }],
    })

    const values = collectStepValues(consumer, graphWith(producer), workspace)

    expect(values).toEqual([{ key: 'producer.version', value: '1.2.3' }])
  })
})
