import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
    'executors/scan/executor': 'src/executors/scan/executor.ts',
  },
  format: ['esm'],
  dts: { eager: true },
  // No clean: executors.json resolves ./dist/executors/*.mjs at task start;
  // wiping dist mid-run-many breaks parallel tasks with ImplementationResolutionError.
  clean: false,
  deps: { alwaysBundle: ['@nx-devkit/internal'] },
})
