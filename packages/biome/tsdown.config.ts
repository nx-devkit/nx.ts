import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  deps: {
    // Transitive deps of @nx/devkit that must not be bundled
    neverBundle: ['nx', '@nx/devkit', 'axios', 'enquirer'],
  },
  dts: true,
  entry: ['src/plugin.ts'],
  format: 'esm',
})
