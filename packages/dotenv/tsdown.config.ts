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
  clean: true,
  deps: { alwaysBundle: ['@nx-devkit/internal'] },
});
