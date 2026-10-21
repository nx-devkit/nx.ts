/**
 * Executor: run a single sverka step as its own Nx task.
 *
 * The step is executed by the sverka engine, so the step keeps its sverka
 * semantics (shell, runtime, secrets, reports). What changes is who owns
 * the *orchestration*: Nx runs the step as a task with its own inputs,
 * outputs and cache entry, and the producing steps run as their own tasks
 * before it — instead of one "run the whole workflow" target.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ExecutorContext } from '@nx/devkit'
import {
  computeGraphId,
  computeRunPlanId,
  type DefinitionGraph,
  type InputValue,
  type RunPlan,
  type StepDefinition,
} from '@sverka/workflow'
import { createEngine, createHostDriver } from '@sverka/runtime'
import { findSverkaConfig, loadDefinitionGraph } from '../../graph.js'
import { findEntryForStep, findStep, type SverkaEntryRef } from '../../plan.js'
import type { StepExecutorSchema } from './schema.js'
import { collectStepValues, materializeImportedArtifacts, publishStepOutputs } from './bridge.js'

/**
 * Run one sverka step.
 */
export async function stepExecutor(
  options: StepExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const workspaceRoot = context.root
  const projectDir = resolveProjectDir(context, workspaceRoot)
  const configPath = options.config
    ? resolveInsideRoot(workspaceRoot, options.config, 'config')
    : findSverkaConfig(projectDir)
  if (!configPath) {
    throw new Error(`no sverka config found in ${projectDir} — expected sverka.config.ts`)
  }

  const graph = await loadDefinitionGraph(configPath)
  const step = resolveStep(graph, configPath, options)
  const entry = resolveEntry(graph, step, options)

  // Two roots, on purpose:
  // - `workspace` is where the step's command runs (the engine's
  //   workspace); an imported artifact is materialized there, because that
  //   is where the command looks for it.
  // - `projectDir` is where the stable artifacts and values live — the
  //   paths the target declares as its Nx outputs. They must not move
  //   when a step runs with a custom `cwd`.
  const workspace = options.cwd ? resolveInsideRoot(workspaceRoot, options.cwd, 'cwd') : projectDir

  const plan = buildStepPlan(graph, step, entry, projectDir, options)

  // Producer artifacts and values come from the tasks that already ran —
  // Nx restored them from the cache.
  materializeImportedArtifacts(step, graph, workspace)

  const outcome = await runPlan(plan, step, workspace, projectDir)

  if (outcome.stdout) {
    process.stdout.write(outcome.stdout.endsWith('\n') ? outcome.stdout : `${outcome.stdout}\n`)
  }
  if (outcome.stderr) {
    process.stderr.write(outcome.stderr.endsWith('\n') ? outcome.stderr : `${outcome.stderr}\n`)
  }

  if (outcome.failure) {
    process.stderr.write(`sverka step "${step.id}" failed: ${outcome.failure}\n`)
    return { success: false }
  }

  return { success: true }
}

/** The step the task runs. */
function resolveStep(
  graph: DefinitionGraph,
  configPath: string,
  options: StepExecutorSchema,
): StepDefinition {
  const step = findStep(graph, options.step)
  if (!step) {
    throw new Error(`sverka step "${options.step}" not found in ${configPath}`)
  }
  return step
}

/** The entry the step is bound to. */
function resolveEntry(
  graph: DefinitionGraph,
  step: StepDefinition,
  options: StepExecutorSchema,
): SverkaEntryRef {
  const entry = options.entry
    ? findEntryById(graph, options.entry)
    : findEntryForStep(graph, step.id)
  if (!entry) {
    throw new Error(
      `sverka entry "${options.entry ?? '(default)'}" does not reach step "${step.id}"`,
    )
  }
  return entry
}

/** What a step run produced. */
interface StepOutcome {
  runId?: string
  failure?: string
  stdout: string
  stderr: string
}

/**
 * Run the plan and publish the step's outputs.
 *
 * The artifacts and values are published to their stable paths so the next
 * task (and the Nx cache) can pick them up — before the temporary
 * artifact directory is removed.
 */
async function runPlan(
  plan: RunPlan,
  step: StepDefinition,
  workspace: string,
  projectDir: string,
): Promise<StepOutcome> {
  const artifactDir = mkdtempSync(join(tmpdir(), 'nx-sverka-'))
  try {
    const outcome = await runStep(plan, workspace, artifactDir)
    try {
      publishStepOutputs(step, artifactDir, outcome.runId, projectDir)
    } catch (error) {
      // A failed publish means the step's outputs are incomplete — report
      // it as a step failure instead of crashing the task runner.
      outcome.failure = outcome.failure ?? errorMessage(error)
    }
    return outcome
  } finally {
    rmSync(artifactDir, { recursive: true, force: true })
  }
}

/** The message of an unknown error. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run the plan on the sverka engine and collect its outcome.
 */
async function runStep(
  plan: RunPlan,
  workspace: string,
  artifactDir: string,
): Promise<StepOutcome> {
  const engine = createEngine({
    drivers: [
      createHostDriver({ enabled: true, allowlist: PERMISSIVE, envAllowlist: ENV_ALLOWLIST }),
    ],
    maxConcurrent: 1,
  })

  const outcome: StepOutcome = { stdout: '', stderr: '' }
  for await (const event of engine.run({ plan, workspace, artifactDir })) {
    if (event.type === 'run-completed') {
      outcome.runId = event.runId
      continue
    }
    if (event.type === 'step-succeeded' || event.type === 'step-failed') {
      outcome.stdout = event.stdout ?? outcome.stdout
      outcome.stderr = event.stderr ?? outcome.stderr
    }
    if (event.type === 'step-failed') {
      outcome.failure = event.error
      continue
    }
    if (event.type === 'diagnostic' && event.severity === 'error') {
      outcome.failure = outcome.failure ?? event.message
    }
  }
  return outcome
}

/**
 * The allowlist is a boundary for untrusted input; a workspace config is
 * trusted input, so every command is allowed.
 */
const PERMISSIVE = { entries: [], isAllowed: () => true }

/** Host variables forwarded to the step's command. */
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'CI',
  'NODE_ENV',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
]

/**
 * Build the run plan for a single step.
 *
 * The step's dependency edges are dropped: Nx already ran the producing
 * tasks (and restored their outputs), so the engine must not try to run
 * them again.
 */
function buildStepPlan(
  graph: DefinitionGraph,
  step: StepDefinition,
  entry: SverkaEntryRef,
  projectDir: string,
  options: StepExecutorSchema,
): RunPlan {
  // The producer's values live under the project directory — the paths the
  // targets declare as their outputs.
  const values = collectStepValues(step, graph, projectDir)
  const inputs: Record<string, InputValue> = { ...options.inputs }
  for (const value of values) {
    inputs[value.key] = value.value
  }

  for (const [name, input] of Object.entries(entry.pipeline.inputs)) {
    if (input.secret) continue
    if (inputs[name] !== undefined) continue
    if (input.default !== undefined) {
      inputs[name] = input.default as InputValue
      continue
    }
    if (input.required ?? true) {
      throw new Error(
        `sverka step "${step.id}" requires input "${name}" — pass it through the target options`,
      )
    }
  }

  const singleStep: StepDefinition = {
    ...step,
    dependencies: [],
    // Imported artifacts are materialized in the workspace before the run.
    operations: step.operations.filter((operation) => operation.kind !== 'importArtifact'),
  }

  const body = {
    apiVersion: 'sverka.dev/v1run' as const,
    graphId: computeGraphId(graph),
    entry: { id: entry.id, trigger: entry.entry.trigger },
    inputs,
    steps: [singleStep],
  }

  return {
    ...body,
    id: computeRunPlanId(body),
    createdAt: new Date().toISOString(),
  }
}

/** Find an entry by id. */
function findEntryById(graph: DefinitionGraph, entryId: string): SverkaEntryRef | undefined {
  for (const pipeline of graph.project.pipelines) {
    const entry = pipeline.entries.find((candidate) => candidate.id === entryId)
    if (entry) return { id: entry.id, pipeline, entry }
  }
  return undefined
}

/**
 * Resolve a workspace-relative option, refusing to leave the workspace.
 *
 * The `config` and `cwd` options are workspace-relative by contract —
 * an absolute or escaping path is a configuration error, not a path to
 * follow.
 */
function resolveInsideRoot(root: string, path: string, option: string): string {
  if (path.startsWith('/') || path.startsWith('~')) {
    throw new Error(`the "${option}" option must be workspace-relative, got "${path}"`)
  }
  const resolved = resolve(root, path)
  const rel = relative(root, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`the "${option}" option must stay inside the workspace, got "${path}"`)
  }
  return resolved
}

/** Absolute directory of the project the task belongs to. */
function resolveProjectDir(context: ExecutorContext, workspaceRoot: string): string {
  const projectName = context.projectName
  if (projectName) {
    const project = context.projectsConfigurations?.projects?.[projectName]
    if (project?.root) return resolve(workspaceRoot, project.root)
  }
  return workspaceRoot
}

export default stepExecutor
