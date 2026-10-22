import type { DefinitionGraph, StepDefinition } from '@sverka/workflow'
import { describe, expect, it } from 'vitest'
import { buildStepTarget, targetNameFor } from './targets.ts'

function makeStep(overrides: Partial<StepDefinition>): StepDefinition {
  return {
    id: 'ci/lint',
    runtime: {},
    operations: [],
    inputs: [],
    outputs: [],
    dependencies: [],
    ...overrides,
  } as StepDefinition
}

const graph: DefinitionGraph = {
  project: { id: 'demo', pipelines: [] },
}

function targetFor(targetStep: StepDefinition) {
  return buildStepTarget(targetStep, 'ci/on-push', {
    projectRoot: '',
    configFile: 'sverka.config.ts',
    graph,
    options: {},
    allSteps: [targetStep],
    targetNames: {},
  })
}

describe('target name', () => {
  it('defaults to <pipeline>:<step>', () => {
    expect(targetNameFor('ci/lint-sarif')).toBe('ci:lint-sarif')
  })

  it('honours a template', () => {
    expect(targetNameFor('ci/lint', { targetName: 'sverka-{step}' })).toBe('sverka-lint')
  })

  it('replaces characters Nx does not accept', () => {
    expect(targetNameFor('ci/lint sarif')).toBe('ci:lint-sarif')
  })
})

describe('redirect targets', () => {
  it('excludes a file the step redirects into', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'oxlint . > report.txt' }],
      }),
    )

    expect(target.inputs).toContain('!{workspaceRoot}/report.txt')
  })

  it('excludes a file the step appends to', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'oxlint . >> report.txt' }],
      }),
    )

    expect(target.inputs).toContain('!{workspaceRoot}/report.txt')
  })

  it('does not exclude a stderr redirection', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'oxlint . 2> errors.txt' }],
      }),
    )

    expect(target.inputs).not.toContain('!{workspaceRoot}/errors.txt')
  })

  it('does not exclude a file named in a quoted command', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'echo "a > b.txt"' }],
      }),
    )

    expect(target.inputs).not.toContain('!{workspaceRoot}/b.txt')
  })

  it('excludes a redirect of a command that also quotes text', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'echo "lint ran" > lint.txt' }],
      }),
    )

    expect(target.inputs).toContain('!{workspaceRoot}/lint.txt')
  })
})

describe('declared outputs', () => {
  it('are excluded from the inputs of the step that writes them', () => {
    const target = targetFor(
      makeStep({
        outputs: [{ name: 'report.json', type: 'artifact', path: 'report.json' }],
      }),
    )

    expect(target.inputs).toContain('!{workspaceRoot}/report.json')
    expect(target.outputs).toEqual(['{workspaceRoot}/report.json'])
  })

  it('are excluded from the inputs of the other steps of the config', () => {
    const writer = makeStep({
      id: 'ci/lint',
      outputs: [{ name: 'report.json', type: 'artifact', path: 'report.json' }],
    })
    const other = makeStep({ id: 'ci/test' })

    const target = buildStepTarget(other, 'ci/on-push', {
      projectRoot: '',
      configFile: 'sverka.config.ts',
      graph,
      options: {},
      allSteps: [writer, other],
      targetNames: {},
    })

    expect(target.inputs).toContain('!{workspaceRoot}/report.json')
  })
})

describe('remote state', () => {
  it('does not cache a step that reads the GitHub state', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'gh api graphql -f query=x' }],
      }),
    )

    expect(target.cache).toBe(false)
  })

  it('caches a step that only reads the project', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'oxlint .' }],
      }),
    )

    expect(target.cache).toBe(true)
  })
})

describe('redirect detection', () => {
  it('excludes an explicit stdout redirection', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'tool 1> report.txt' }],
      }),
    )

    expect(target.inputs).toContain('!{workspaceRoot}/report.txt')
  })

  it('does not exclude a stderr redirection', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'tool 2> report.txt' }],
      }),
    )

    expect(target.inputs).not.toContain('!{workspaceRoot}/report.txt')
  })

  it('does not treat an escaped quote as the end of a string', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'echo "a \\" > b.txt"' }],
      }),
    )

    expect(target.inputs).not.toContain('!{workspaceRoot}/b.txt')
  })
})

describe('quoted commands', () => {
  it('keeps a redirection outside a quoted string', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'tool "a" > report.txt' }],
      }),
    )

    expect(target.inputs).toContain('!{workspaceRoot}/report.txt')
  })

  it('handles a long run of escaped quotes without hanging', () => {
    const command = `echo "${'\\"'.repeat(200)}" > report.txt`
    const target = targetFor(makeStep({ operations: [{ kind: 'shell', command }] }))

    expect(target.inputs).toContain('!{workspaceRoot}/report.txt')
  })
})

describe('stderr appends', () => {
  it('does not exclude a file written by a stderr append', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'tool 2>> errors.txt' }],
      }),
    )

    expect(target.inputs).not.toContain('!{workspaceRoot}/errors.txt')
  })

  it('excludes a file written by a combined stdout/stderr append', () => {
    const target = targetFor(
      makeStep({
        operations: [{ kind: 'shell', command: 'tool &>> errors.txt' }],
      }),
    )

    expect(target.inputs).toContain('!{workspaceRoot}/errors.txt')
  })
})
