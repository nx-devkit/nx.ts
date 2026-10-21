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
import { join, resolve } from 'node:path'
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
    ? resolve(workspaceRoot, options.config)
    : findSverkaConfig(projectDir)
  if (!configPath) {
    throw new Error(`no sverka config found in ${projectDir} — expected sverka.config.ts`)
  }

  const graph = await loadDefinitionGraph(configPath)
  const step = findStep(graph, options.step)
  if (!step) {
    throw new Error(`sverka step "${options.step}" not found in ${configPath}`)
  }

  const entry = options.entry
    ? findEntryById(graph, options.entry)
    : findEntryForStep(graph, step.id)
  if (!entry) {
    throw new Error(
      `sverka entry "${options.entry ?? '(default)'}" does not reach step "${step.id}"`,
    )
  }

  // The step runs inside the project directory — the same directory the
  // engine would use for the whole config.
  const workspace = options.cwd ? resolve(workspaceRoot, options.cwd) : projectDir

  const plan = buildStepPlan(graph, step, entry, workspace, options)

  // Producer artifacts and values come from the tasks that already ran —
  // Nx restored them from the cache.
  materializeImportedArtifacts(step, graph, workspace)

  const artifactDir = mkdtempSync(join(tmpdir(), 'nx-sverka-'))
  const engine = createEngine({
    drivers: [
      createHostDriver({
        enabled: true,
        // The allowlist is a boundary for untrusted input; a workspace
        // config is trusted input, so every command is allowed.
        allowlist: { entries: [], isAllowed: () => true },
        envAllowlist: [
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
        ],
      }),
    ],
    maxConcurrent: 1,
  })

  let runId: string | undefined
  let failure: string | undefined
  let stdout = ''
  let stderr = ''

  try {
    for await (const event of engine.run({ plan, workspace, artifactDir })) {
      if (event.type === 'run-completed') {
        runId = event.runId
      }
      if (event.type === 'step-succeeded' || event.type === 'step-failed') {
        stdout = event.stdout ?? stdout
        stderr = event.stderr ?? stderr
      }
      if (event.type === 'step-failed') {
        failure = event.error
      }
      if (event.type === 'diagnostic' && event.severity === 'error') {
        failure = failure ?? event.message
      }
    }

    // Publish the step's artifacts and values to their stable paths so the
    // next task (and the Nx cache) can pick them up. This has to happen
    // before the temporary artifact directory is removed.
    try {
      publishStepOutputs(step, artifactDir, runId, workspace)
    } catch (error) {
      // A failed publish means the step's outputs are incomplete — report
      // it as a step failure instead of crashing the task runner.
      failure = failure ?? (error instanceof Error ? error.message : String(error))
    }
  } finally {
    rmSync(artifactDir, { recursive: true, force: true })
  }

  if (stdout) {
    process.stdout.write(stdout.endsWith('\n') ? stdout : `${stdout}\n`)
  }
  if (stderr) {
    process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`)
  }

  if (failure) {
    process.stderr.write(`sverka step "${step.id}" failed: ${failure}\n`)
    return { success: false }
  }

  return { success: true }
}

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
  workspace: string,
  options: StepExecutorSchema,
): RunPlan {
  const values = collectStepValues(step, graph, workspace)
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
