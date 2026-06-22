export { createNodesV2, isReleaseBootstrapProject } from './plugin.ts'
export { publishPlaceholderExecutor } from './executors/publish-placeholder/executor.ts'
export type {
  NxPrepareForReleaseOptions,
  PublishPlaceholderResult,
  PublishPlaceholderContext,
} from './executors/publish-placeholder/executor.ts'
export { initGenerator } from './generators/init/generator.ts'
export type { NxPrepareForReleaseInitOptions } from './generators/init/generator.ts'
