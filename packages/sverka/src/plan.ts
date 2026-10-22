/**
 * Navigation helpers over a sverka Definition Graph.
 *
 * A graph is `Project → Pipelines → Steps / Entries`. An entry lists the
 * step ids it starts from; the steps an entry can reach are the roots plus
 * everything they transitively depend on. Those are the steps an Nx target
 * is inferred for.
 */
import { computeReachableSteps } from '@sverka/sdk'
import {
  expandPipelineCalls,
  type DefinitionGraph,
  type EntryDefinition,
  type PipelineDefinition,
  type StepDefinition,
} from '@sverka/workflow'

/** An entry together with the pipeline that owns it. */
export interface SverkaEntryRef {
  /** Fully qualified entry id, e.g. `ci/on-push`. */
  id: string
  pipeline: PipelineDefinition
  entry: EntryDefinition
}

/** Every entry in the graph, in declaration order. */
export function collectEntries(graph: DefinitionGraph): SverkaEntryRef[] {
  const entries: SverkaEntryRef[] = []
  for (const pipeline of graph.project.pipelines) {
    for (const entry of pipeline.entries) {
      entries.push({ id: entry.id, pipeline, entry })
    }
  }
  return entries
}

/**
 * The steps an entry can reach, with pipeline-call steps expanded into the
 * steps they call.
 */
export function stepsForEntry(graph: DefinitionGraph, ref: SverkaEntryRef): StepDefinition[] {
  const reachable = computeReachableSteps(ref.pipeline.steps, ref.entry.roots)
  return [...expandPipelineCalls(graph, reachable)]
}

/**
 * Find the entry that can reach `stepId`.
 *
 * Used by the executor when a target does not pin an entry: the step id
 * alone identifies the step, the entry only decides which bound inputs
 * the run uses.
 */
export function findEntryForStep(
  graph: DefinitionGraph,
  stepId: string,
): SverkaEntryRef | undefined {
  for (const ref of collectEntries(graph)) {
    if (stepsForEntry(graph, ref).some((step) => step.id === stepId)) {
      return ref
    }
  }
  return undefined
}

/**
 * Find a step by id across every pipeline of the graph.
 */
export function findStep(graph: DefinitionGraph, stepId: string): StepDefinition | undefined {
  for (const pipeline of graph.project.pipelines) {
    const step = pipeline.steps.find((candidate) => candidate.id === stepId)
    if (step) return step
  }
  return undefined
}

/**
 * Producer step ids a step depends on.
 *
 * Every dependency kind (control, value, artifact) is an ordering edge:
 * the producer must run before the consumer, so Nx models it as a
 * `dependsOn` between the two targets.
 */
export function dependencyProducers(step: StepDefinition): string[] {
  return step.dependencies.map((dependency) => dependency.producer)
}

/**
 * Split a fully qualified step id (`pipeline/step`) into its parts.
 */
export function splitStepId(stepId: string): { pipelineId: string; stepId: string } {
  const index = stepId.lastIndexOf('/')
  if (index === -1) return { pipelineId: '', stepId }
  return { pipelineId: stepId.slice(0, index), stepId: stepId.slice(index + 1) }
}
