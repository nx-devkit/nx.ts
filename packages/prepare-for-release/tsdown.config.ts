import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
    'executors/publish-placeholder/executor': 'src/executors/publish-placeholder/executor.ts',
    'generators/init/generator': 'src/generators/init/generator.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
})
