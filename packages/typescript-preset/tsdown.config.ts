import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/plugin.ts',
    'src/generators/init/generator.ts',
    'src/bin/init.ts',
    'src/migrations/update-1-0-0/replace-typecheck-executor.ts',
    'src/migrations/update-1-0-0/replace-build-executor.ts',
    'src/executors/typecheck/executor.ts',
    'src/executors/build/executor.ts',
  ],
  format: ['esm'],
  dts: { eager: true },
  // No clean: executors.json resolves ./dist/executors/*.mjs while a parallel
  // `nx run-many` may rebuild this package — wiping dist mid-run breaks every
  // concurrent typecheck/build with ImplementationResolutionError. Release
  // builds start from a fresh checkout anyway.
  clean: false,
  deps: { alwaysBundle: ['@nx-devkit/internal'] },
})
