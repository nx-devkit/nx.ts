import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: ['nx', '@nx/devkit', 'axios', 'enquirer'],
  },
  dts: true,
  entry: ['src/plugin.ts'],
  format: 'esm',
})
