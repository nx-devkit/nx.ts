import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'executors/check/executor': 'src/executors/check/executor.ts',
    'generators/init/generator': 'src/generators/init/generator.ts',
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
  },
  format: ['esm'],
  dts: { generator: 'oxc' },
  // No clean: executors.json resolves ./dist/executors/*.mjs at task start;
  // wiping dist mid-run-many breaks parallel tasks with ImplementationResolutionError.
  clean: false,
  deps: { alwaysBundle: ['@nx-devkit/internal'] },
});
