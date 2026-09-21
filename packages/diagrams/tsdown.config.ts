import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: ['@nx-devkit/internal'],
    // Transitive deps of @nx/devkit that must not be bundled
    neverBundle: ['nx', '@nx/devkit', 'axios', 'enquirer'],
  },
  dts: true,
  entry: {
    'executors/render/executor': 'src/executors/render/executor.ts',
    'generators/init/generator': 'src/generators/init/generator.ts',
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
  },
  format: ['esm'],
})
