import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/generators/init/generator.ts', 'src/plugin.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  deps: { alwaysBundle: ['@nx-devkit/internal'] },
})
