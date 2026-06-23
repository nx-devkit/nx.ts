import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    'executors/publish-placeholder/executor': 'src/executors/publish-placeholder/executor.ts',
    'generators/init/generator': 'src/generators/init/generator.ts',
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
  },
  format: ['esm'],
})
