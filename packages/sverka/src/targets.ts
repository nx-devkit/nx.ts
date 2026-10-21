/**
 * Mapping a sverka step onto an Nx target.
 *
 * Every step becomes its own target, so each one keeps a separate cache
 * entry with its own inputs and outputs:
 *
 * - **inputs** — the files the step reads: the project's own files, the
 *   producer artifacts/values it consumes, and the sverka config itself.
 * - **outputs** — the files the step produces, at stable paths the
 *   executor writes to (see `paths.ts`).
 * - **dependsOn** — the producer steps, so Nx runs (and restores) them
 *   first instead of the plugin collapsing everything into one run.
 */
import type { TargetConfiguration } from '@nx/devkit'
import type { DefinitionGraph, StepDefinition } from '@sverka/workflow'
import { dependencyProducers, splitStepId } from './plan.js'
import { stableOutputPaths, stepArtifactsRelativeDir } from './paths.js'
import { DEFAULT_TARGET_NAME, type NxDevkitSverkaOptions } from './types.js'

/** Everything the mapping needs besides the step itself. */
export interface TargetContext {
  /** Project root relative to the workspace root (`''` for the root project). */
  projectRoot: string
  /** Config file relative to the workspace root. */
  configFile: string
  graph: DefinitionGraph
  options: NxDevkitSverkaOptions
  /** Every step of the config — the files they write are excluded from the inputs of all steps. */
  allSteps: StepDefinition[]
}

/**
 * Characters allowed in an Nx target name.
 *
 * Colons are allowed — Nx splits `project:target` on the segment that
 * matches a known target, so `ci:lint` is a valid target name.
 */
const UNSAFE_TARGET_CHARS = /[^A-Za-z0-9._:-]+/g

/**
 * A stdout redirection: `> file` or `>> file`.
 *
 * The lookbehind keeps stderr redirections (`2>`, `&>`) out — they write
 * to the error stream, not to a file the step reads back.
 */
const REDIRECT = /(?<![0-9>&])>{1,2}\s*([^\s>|;&]+)/g

/**
 * Resolve the target name of a step.
 *
 * The default template is `{pipeline}:{step}` — `ci/lint` becomes `ci:lint`.
 */
export function targetNameFor(stepId: string, options: NxDevkitSverkaOptions = {}): string {
  const template = options.targetName ?? DEFAULT_TARGET_NAME
  const { pipelineId, stepId: bareStepId } = splitStepId(stepId)
  return sanitize(
    template
      .replaceAll('{pipeline}', pipelineId)
      .replaceAll('{step}', bareStepId)
      .replaceAll('{id}', stepId),
  )
}

/** Replace characters Nx does not accept in a target name. */
function sanitize(name: string): string {
  return name.replace(UNSAFE_TARGET_CHARS, '-')
}

/**
 * Build the Nx target for a sverka step.
 */
export function buildStepTarget(
  step: StepDefinition,
  entryId: string,
  context: TargetContext,
): TargetConfiguration {
  const { projectRoot, configFile, graph, options, allSteps } = context
  const prefix = projectRoot ? '{projectRoot}' : '{workspaceRoot}'

  const outputs = stableOutputPaths(step.id, step.outputs)
  const producerPaths = consumedProducerPaths(step, graph)
  const consumed = new Set(producerPaths)

  // Every file the config's steps write into the project. They are outputs
  // of *some* step, so hashing them as inputs of every step would make the
  // steps invalidate each other.
  const projectWrites = collectProjectWrites(allSteps)

  const inputs: NonNullable<TargetConfiguration['inputs']> = [
    `${prefix}/**/*`,
    // The engine's scratch space changes on every run — it is never an
    // input.
    `!${prefix}/.sverka/workspace/**`,
    // The step's own published artifacts are its outputs, not its inputs.
    `!${prefix}/${stepArtifactsRelativeDir(step.id)}/**`,
    ...[...projectWrites].filter((path) => !consumed.has(path)).map((path) => `!${prefix}/${path}`),
    `${prefix}/${configFile}`,
    // The artifacts the step consumes — their content decides whether the
    // consumer can be restored from the cache.
    ...producerPaths.map((path) => `${prefix}/${path}`),
    // The same artifacts as "outputs of the tasks I depend on": Nx hashes
    // the consumer after the producer ran and folds the producer's hash
    // into it, so a changed producer invalidates the consumer.
    ...producerPaths.map((path) => ({
      dependentTasksOutputFiles: workspaceRelative(projectRoot, path),
    })),
    ...(options.inputs ?? []),
  ]

  const dependsOn = dependencyProducers(step).map((producer) => targetNameFor(producer, options))

  return {
    executor: '@nx-devkit/sverka:step',
    options: {
      step: step.id,
      entry: entryId,
    },
    inputs,
    outputs: Object.values(outputs).map((path) => `${prefix}/${path}`),
    cache: options.cache ?? true,
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  }
}

/**
 * File names of the artifacts a step imports.
 *
 * The engine materializes an imported artifact in the project directory
 * under its own name, right before the step runs.
 */
function importedArtifactNames(step: StepDefinition): string[] {
  const names: string[] = []
  for (const operation of step.operations) {
    if (operation.kind === 'importArtifact') names.push(operation.name)
  }
  return names
}

/**
 * Workspace-relative path of a project-relative path.
 */
function workspaceRelative(projectRoot: string, path: string): string {
  return projectRoot ? `${projectRoot}/${path}` : path
}

/**
 * Every file the config's steps write into the project.
 *
 * Declared outputs, imported artifacts (materialized in the project
 * directory) and the files a shell step redirects into.
 */
function collectProjectWrites(steps: StepDefinition[]): Set<string> {
  const writes = new Set<string>()
  for (const step of steps) {
    for (const path of Object.values(stableOutputPaths(step.id, step.outputs))) {
      writes.add(path)
    }
    for (const name of importedArtifactNames(step)) writes.add(name)
    for (const name of redirectTargets(step)) writes.add(name)
  }
  return writes
}

/**
 * Files a shell step redirects its output into.
 *
 * A step that writes a report into the project (`tool > report.txt`) would
 * otherwise invalidate its own cache: the file is part of the project files
 * the target hashes. Steps that declare their outputs are covered by that
 * declaration — this covers the ones that do not.
 *
 * The detection is deliberately conservative: only stdout redirections of
 * a command without quotes count. A quoted command is not parsed (a `>`
 * inside a string is not a redirection), and a stderr redirection (`2>`,
 * `&>`) writes nothing the step reads back.
 */
function redirectTargets(step: StepDefinition): string[] {
  const targets: string[] = []
  for (const operation of step.operations) {
    if (operation.kind !== 'shell') continue
    if (operation.command.includes('"') || operation.command.includes("'")) continue
    for (const match of operation.command.matchAll(REDIRECT)) {
      const target = match[1]
      if (!target) continue
      // Only plain relative paths inside the project are excluded.
      if (target.startsWith('/') || target.startsWith('~')) continue
      if (target.includes('$') || target.includes('`')) continue
      targets.push(target)
    }
  }
  return targets
}

/**
 * Stable paths of the producer outputs a step consumes.
 *
 * A step declares what it reads through its `inputs` references; the
 * producer's stable output path for that reference becomes an input of the
 * consuming target, so a changed artifact invalidates the consumer's cache.
 */
function consumedProducerPaths(step: StepDefinition, graph: DefinitionGraph): string[] {
  const paths: string[] = []
  for (const reference of step.inputs) {
    if (reference.kind !== 'step') continue
    const producerId = resolveProducerId(step.id, reference.step)
    const producer = findStepById(graph, producerId)
    if (!producer) continue
    const producerOutputs = stableOutputPaths(producer.id, producer.outputs)
    const path = producerOutputs[reference.output]
    if (path) paths.push(path)
  }
  return paths
}

/** Find a step by fully qualified id. */
function findStepById(graph: DefinitionGraph, stepId: string): StepDefinition | undefined {
  for (const pipeline of graph.project.pipelines) {
    const step = pipeline.steps.find((candidate) => candidate.id === stepId)
    if (step) return step
  }
  return undefined
}

/**
 * Resolve a producer reference to a fully qualified step id.
 *
 * A step may reference a sibling by its bare id (`lint-sarif`) — the
 * pipeline prefix is added back.
 */
export function resolveProducerId(fromStepId: string, reference: string): string {
  if (reference.includes('/')) return reference
  const index = fromStepId.lastIndexOf('/')
  if (index === -1) return reference
  return `${fromStepId.slice(0, index)}/${reference}`
}
