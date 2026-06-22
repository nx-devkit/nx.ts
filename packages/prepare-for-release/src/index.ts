export { createNodesV2, isReleaseBootstrapProject } from './plugin.js'
export { publishPlaceholderExecutor } from './executors/publish-placeholder/executor.js'
export type {
  NxPrepareForReleaseOptions,
  PublishPlaceholderResult,
  PublishPlaceholderContext,
} from './executors/publish-placeholder/executor.js'
export { initGenerator } from './generators/init/generator.js'
export type { NxPrepareForReleaseInitOptions } from './generators/init/generator.js'
