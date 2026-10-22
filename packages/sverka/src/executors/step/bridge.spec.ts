import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
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

/** The producer step the consumer imports from. */
function producerStep(): StepDefinition {
  return step({
    id: 'ci/producer',
    outputs: [{ name: 'report.json', type: 'artifact', fromStdout: true }],
  })
}

/** A consumer that imports `name` from the producer. */
function importConsumer(name: string): StepDefinition {
  return step({
    operations: [
      {
        kind: 'importArtifact',
        name,
        from: 'ci/producer',
        output: 'report.json',
      },
    ],
  })
}

function graphWith(...producers: StepDefinition[]): DefinitionGraph {
  return {
    project: {
      id: 'demo',
      pipelines: [{ id: 'ci', inputs: {}, entries: [], steps: producers, outputs: [] }],
    },
  }
}

/** A step that publishes a stdout artifact. */
function stdoutProducer(name: string): StepDefinition {
  return step({
    id: 'ci/producer',
    operations: [
      { kind: 'shell', command: 'true' },
      { kind: 'exportStdout', name },
    ],
  })
}

/** The directory a stdout artifact is published to. */
function artifactPath(workspace: string, name: string): string {
  return join(workspace, '.sverka', 'artifacts', 'ci', 'producer', name)
}

describe('artifact bridge', () => {
  it('materializes an imported artifact in the project directory', () => {
    const workspace = makeWorkspace()
    const consumer = importConsumer('report.json')

    const materialized = materializeImportedArtifacts(
      consumer,
      graphWith(producerStep()),
      workspace,
      workspace,
    )

    expect(materialized).toEqual([join(workspace, 'report.json')])
  })

  it('refuses to materialize an artifact outside the project directory', () => {
    const workspace = makeWorkspace()
    const consumer = importConsumer('../../escaped.json')

    expect(() =>
      materializeImportedArtifacts(consumer, graphWith(producerStep()), workspace, workspace),
    ).toThrow(/escapes the project directory/)
  })

  it('refuses to follow a symlink out of the project directory', () => {
    const workspace = makeWorkspace()
    const outside = mkdtempSync(join(tmpdir(), 'nx-sverka-outside-'))
    symlinkSync(outside, join(workspace, 'linked'), 'dir')

    expect(() =>
      materializeImportedArtifacts(
        importConsumer('linked/escaped.json'),
        graphWith(producerStep()),
        workspace,
        workspace,
      ),
    ).toThrow(/escapes the project directory/)
  })

  it('refuses to read a producer output outside the project directory', () => {
    const workspace = makeWorkspace()
    const escaping = step({
      id: 'ci/producer',
      outputs: [{ name: 'report.json', type: 'artifact', path: '../escaped.json' }],
    })

    expect(() =>
      materializeImportedArtifacts(
        importConsumer('report.json'),
        graphWith(escaping),
        workspace,
        workspace,
      ),
    ).toThrow(/declares no such output/)
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

    const published = publishStepOutputs(
      stdoutProducer('report.json'),
      artifactDir,
      runId,
      workspace,
    )

    expect(published).toEqual([artifactPath(workspace, 'report.json')])
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

    const values = collectStepValues(
      versionConsumer('producer'),
      graphWith(versionProducer('1.2.3')),
      workspace,
    )

    expect(values).toEqual([{ key: 'producer.version', value: '1.2.3' }])
  })

  it('picks the producer the command names when several publish the same output', () => {
    const workspace = makeWorkspace()
    for (const id of ['a', 'b']) {
      mkdirSync(join(workspace, '.sverka', 'artifacts', 'ci', id, 'values'), {
        recursive: true,
      })
      writeFileSync(
        join(workspace, '.sverka', 'artifacts', 'ci', id, 'values', 'version'),
        id === 'a' ? '1.0.0' : '2.0.0',
      )
    }

    const consumer = step({
      operations: [{ kind: 'shell', command: `echo \${b.version}` }],
      inputs: [
        { kind: 'step', step: 'a', output: 'version', type: 'string' },
        { kind: 'step', step: 'b', output: 'version', type: 'string' },
      ],
    })

    const values = collectStepValues(
      consumer,
      graphWith(versionProducer('1.0.0', 'ci/a'), versionProducer('2.0.0', 'ci/b')),
      workspace,
    )

    expect(values).toEqual([{ key: 'b.version', value: '2.0.0' }])
  })
})

/** A producer that publishes a version value. */
function versionProducer(value: string, id = 'ci/producer'): StepDefinition {
  void value
  return step({
    id,
    outputs: [{ name: 'version', type: 'string' }],
  })
}

/** A consumer that reads a version value. */
function versionConsumer(namespace: string): StepDefinition {
  return step({
    operations: [{ kind: 'shell', command: `echo \${${namespace}.version}` }],
    inputs: [{ kind: 'step', step: 'producer', output: 'version', type: 'string' }],
  })
}

describe('missing outputs', () => {
  it('removes a stale artifact when a declared output is not produced', () => {
    const workspace = makeWorkspace()
    // The producer declared this output in an earlier run.
    writeFileSync(artifactPath(workspace, 'stale.json'), '{"old":true}')

    const stepWithOutput = step({
      id: 'ci/producer',
      operations: [{ kind: 'shell', command: 'true' }],
      outputs: [{ name: 'stale.json', type: 'artifact', fromStdout: true }],
    })

    publishStepOutputs(stepWithOutput, join(workspace, '.tmp'), undefined, workspace)

    expect(existsSync(artifactPath(workspace, 'stale.json'))).toBe(false)
  })
})

describe('stale values', () => {
  it('removes a stale value file when the step does not produce it', () => {
    const workspace = makeWorkspace()
    const valuePath = join(workspace, '.sverka', 'artifacts', 'ci', 'producer', 'values', 'version')
    mkdirSync(dirname(valuePath), { recursive: true })
    writeFileSync(valuePath, '1.0.0')

    const producer = step({
      id: 'ci/producer',
      operations: [{ kind: 'shell', command: 'true' }],
      outputs: [{ name: 'version', type: 'string' }],
    })

    publishStepOutputs(producer, join(workspace, '.tmp'), undefined, workspace)

    expect(existsSync(valuePath)).toBe(false)
  })
})

describe('symlink destinations', () => {
  it('refuses a dangling symlink at the destination', () => {
    const workspace = makeWorkspace()
    const outside = mkdtempSync(join(tmpdir(), 'nx-sverka-outside-'))
    symlinkSync(join(outside, 'missing.json'), join(workspace, 'report.json'))

    expect(() =>
      materializeImportedArtifacts(
        importConsumer('report.json'),
        graphWith(producerStep()),
        workspace,
        workspace,
      ),
    ).toThrow(/escapes the project directory/)
  })
})
