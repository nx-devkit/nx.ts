import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'generators/init/generator': 'src/generators/init/generator.ts',
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
    'executors/build/executor': 'src/executors/build/executor.ts',
    'executors/validate/executor': 'src/executors/validate/executor.ts',
    'executors/os-check/executor': 'src/executors/os-check/executor.ts',
    'executors/size-check/executor': 'src/executors/size-check/executor.ts',
  },
  format: ['esm'],
  dts: { eager: true },
  // No clean: executors.json resolves ./dist/executors/*.mjs while a parallel
  // `nx run-many` may rebuild this package — wiping dist mid-run breaks
  // concurrent tasks resolving the executor with ImplementationResolutionError.
  clean: false,
  deps: { alwaysBundle: ['@nx-devkit/internal'] },
})
