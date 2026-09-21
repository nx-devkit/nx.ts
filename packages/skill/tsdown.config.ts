import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
    'executors/build/executor': 'src/executors/build/executor.ts',
  },
  format: ['esm'],
  dts: { eager: true },
  // No clean: executors.json resolves ./dist/executors/*.mjs while a parallel
  // `nx run-many` may rebuild this package — wiping dist mid-run breaks
  // concurrent tasks resolving the executor with ImplementationResolutionError.
  clean: false,
  deps: { alwaysBundle: ['@nx-devkit/internal'] },
})
