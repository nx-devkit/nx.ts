import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
    'executors/build/executor': 'src/executors/build/executor.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
})
