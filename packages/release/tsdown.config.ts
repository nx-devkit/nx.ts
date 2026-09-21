import { defineConfig } from 'tsdown'

export default defineConfig({
  // No clean: executors.json resolves ./dist/executors/*.mjs at task start;
  // wiping dist mid-run-many breaks parallel tasks with ImplementationResolutionError.
  clean: false,
  dts: true,
  entry: {
    'executors/publish/executor': 'src/executors/publish/executor.ts',
    'generators/init/generator': 'src/generators/init/generator.ts',
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
  },
  format: ['esm'],
})
