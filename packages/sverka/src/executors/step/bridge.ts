/**
 * The artifact/value bridge between sverka steps and Nx tasks.
 *
 * A sverka step hands artifacts to its consumers through an in-memory
 * artifact store that lives inside a single run. Nx runs each step in its
 * own task, possibly in another process, and caches the results in between.
 * The bridge moves the data across that gap:
 *
 * - **before** the run: a consumer's imported artifacts are copied from the
 *   producer's stable path into the workspace where the step expects them,
 *   and the producer's values are read back so the command can interpolate
 *   them.
 * - **after** the run: the step's own artifacts and values are copied to
 *   their stable paths, which the target declares as its Nx outputs.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { DefinitionGraph, StepDefinition } from '@sverka/workflow'
import { artifactRelativePath, valueRelativePath } from '../../paths.js'
import { resolveProducerId } from '../../targets.js'

/** `${namespace.field}` references inside a step command. */
const COMMAND_REF = /\$\{([^.{}]+)\.([^{}]+)\}/g

/** Context namespaces the engine resolves itself. */
const CONTEXT_NAMESPACES = new Set([
  'env',
  'git',
  'inputs',
  'secrets',
  'change',
  'event',
  'run',
  'matrix',
])

/** A value read back from a producer step. */
export interface BridgedValue {
  /** The literal `${namespace.field}` key the command uses. */
  key: string
  value: string | number | boolean
}

/**
 * Copy the artifacts a step imports into the workspace.
 *
 * The engine would normally pull them from the artifact store of the
 * producing step; that store does not exist in a separate Nx task, so the
 * producer's stable output path is used instead.
 */
export function materializeImportedArtifacts(
  step: StepDefinition,
  graph: DefinitionGraph,
  workspace: string,
): string[] {
  const materialized: string[] = []
  for (const operation of step.operations) {
    if (operation.kind !== 'importArtifact') continue
    const producerId = resolveProducerId(step.id, operation.from)
    const source = producerOutputPath(graph, producerId, operation.output, workspace)
    if (!source) {
      throw new Error(
        `sverka step "${step.id}" imports "${operation.output}" from "${producerId}", but that step declares no such output`,
      )
    }
    if (!existsSync(source)) {
      throw new Error(
        `sverka step "${step.id}" imports "${operation.output}" from "${producerId}", but ${source} does not exist — run the producing target first`,
      )
    }
    const destination = resolveInside(workspace, operation.name)
    if (!destination) {
      throw new Error(
        `sverka step "${step.id}" imports "${operation.output}" as "${operation.name}" — the destination escapes the project directory`,
      )
    }
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    materialized.push(destination)
  }
  return materialized
}

/**
 * Resolve a path inside the workspace.
 *
 * Returns `undefined` when the path escapes it — a config is trusted input
 * for the *commands* it runs, but never for the *paths* it writes: an
 * artifact name or an output path must never leave the project directory.
 */
function resolveInside(workspace: string, path: string): string | undefined {
  const resolved = resolve(workspace, path)
  const rel = relative(workspace, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  return resolved
}

/**
 * Read the values a step consumes from its producers.
 *
 * The engine keeps values in memory for the duration of a run; across Nx
 * tasks they are read back from the producer's stable value path.
 */
export function collectStepValues(
  step: StepDefinition,
  graph: DefinitionGraph,
  workspace: string,
): BridgedValue[] {
  const values: BridgedValue[] = []
  for (const operation of step.operations) {
    if (operation.kind !== 'shell') continue
    for (const match of operation.command.matchAll(COMMAND_REF)) {
      const [, namespace, field] = match
      if (!namespace || !field) continue
      if (CONTEXT_NAMESPACES.has(namespace)) continue

      const reference = step.inputs.find((input) => input.kind === 'step' && input.output === field)
      if (reference?.kind !== 'step') continue

      const producerId = resolveProducerId(step.id, reference.step)
      const producer = findStep(graph, producerId)
      if (!producer) continue

      const bareId = producerId.split('/').pop() ?? producerId
      if (namespace !== bareId && namespace !== producerId) continue

      const valuePath = resolveInside(workspace, valueRelativePath(producerId, field))
      if (!valuePath) continue
      const value = readValue(valuePath, reference.type)
      if (value === undefined) continue
      values.push({ key: `${namespace}.${field}`, value })
    }
  }
  return values
}

/**
 * Copy the step's own artifacts and values to their stable paths.
 *
 * @param artifactDir the engine's artifact directory (the run id is
 *   appended to it by the engine)
 * @param runId the id of the run that just finished
 */
export function publishStepOutputs(
  step: StepDefinition,
  artifactDir: string,
  runId: string | undefined,
  workspace: string,
): string[] {
  const published: string[] = []
  const runArtifactDir = findRunDir(artifactDir, runId)

  for (const operation of step.operations) {
    if (operation.kind === 'exportStdout') {
      if (!runArtifactDir) continue
      const source = join(runArtifactDir, step.id, operation.name)
      if (!existsSync(source)) continue
      const destination = resolveInside(workspace, artifactRelativePath(step.id, operation.name))
      if (!destination) continue
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      published.push(destination)
      continue
    }

    if (operation.kind === 'exportOutput') {
      const source = join(workspace, '.sverka', 'workspace', step.id, '.outputs', operation.name)
      if (!existsSync(source)) continue
      const destination = resolveInside(workspace, valueRelativePath(step.id, operation.name))
      if (!destination) continue
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      published.push(destination)
      continue
    }

    if (operation.kind === 'exportArtifact') {
      // The step wrote the file into the workspace — that path *is* the
      // stable output.
      const destination = resolveInside(workspace, operation.path)
      if (!destination) continue
      if (existsSync(destination)) published.push(destination)
    }
  }

  return published
}

/**
 * Stable path of a producer's output.
 *
 * Artifacts written to a path keep that path; artifacts captured from
 * stdout were published to the artifacts directory by the producer.
 */
function producerOutputPath(
  graph: DefinitionGraph,
  producerId: string,
  outputName: string,
  workspace: string,
): string | undefined {
  const producer = findStep(graph, producerId)
  if (!producer) return undefined
  const output = producer.outputs.find((candidate) => candidate.name === outputName)
  if (!output) return undefined
  if (output.path) return resolveInside(workspace, output.path)
  return resolveInside(workspace, artifactRelativePath(producerId, outputName))
}

/** Find a step by fully qualified id. */
function findStep(graph: DefinitionGraph, stepId: string): StepDefinition | undefined {
  for (const pipeline of graph.project.pipelines) {
    const step = pipeline.steps.find((candidate) => candidate.id === stepId)
    if (step) return step
  }
  return undefined
}

/** Read and parse a published value file. */
function readValue(path: string, type: string): string | number | boolean | undefined {
  if (!existsSync(path)) return undefined
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  const trimmed = content.trim()
  if (type === 'number') {
    const value = Number(trimmed)
    return Number.isNaN(value) ? undefined : value
  }
  if (type === 'boolean') return trimmed === 'true'
  return trimmed
}

/**
 * Locate the run directory the engine created inside `artifactDir`.
 *
 * The engine appends the run id to the artifact directory; a fallback scan
 * keeps the bridge working when the run id is not known.
 */
function findRunDir(artifactDir: string, runId?: string): string | undefined {
  if (runId) {
    const candidate = join(artifactDir, runId)
    if (existsSync(candidate)) return candidate
  }
  try {
    const entries = readdirSync(artifactDir, { withFileTypes: true })
    const dirs = entries.filter((entry) => entry.isDirectory())
    if (dirs.length === 0) return undefined
    const newest = dirs
      .map((entry) => join(artifactDir, entry.name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    return newest
  } catch {
    return undefined
  }
}
