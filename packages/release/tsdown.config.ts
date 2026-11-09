import { defineConfig } from 'tsdown'

export default defineConfig({
  // No clean: executors.json resolves ./dist/executors/*.mjs at task start;
  // wiping dist mid-run-many breaks parallel tasks with ImplementationResolutionError.
  clean: false,
  dts: true,
  entry: {
    'executors/publish/executor': 'src/executors/publish/executor.ts',
    'executors/version/executor': 'src/executors/version/executor.ts',
    'executors/changelog/executor': 'src/executors/changelog/executor.ts',
    'executors/plan/executor': 'src/executors/plan/executor.ts',
    'generators/init/generator': 'src/generators/init/generator.ts',
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
  },
  format: ['esm'],
})
