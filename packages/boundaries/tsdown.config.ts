import { defineConfig } from 'tsdown'

export default defineConfig({
  // No clean: executors.json resolves ./dist/executors/*.mjs at task start.
  // Wiping dist mid-run-many breaks parallel tasks with ImplementationResolutionError.
  clean: false,
  deps: {
    alwaysBundle: ['@nx-devkit/internal'],
    neverBundle: ['nx', '@nx/devkit', 'typescript'],
  },
  dts: true,
  entry: {
    'executors/check-boundaries/executor': 'src/executors/check-boundaries/executor.ts',
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
  },
  format: ['esm'],
})
