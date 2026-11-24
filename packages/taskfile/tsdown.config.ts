import { defineConfig } from 'tsdown';

export default defineConfig({
  // Plugin-only package: `.` resolves to dist/plugin.mjs (same as
  // terraform/eslint/biome). src/index.ts is the source-level public
  // surface but ships no separate entry — it would be unreachable.
  entry: ['src/generators/init/generator.ts', 'src/plugin.ts'],
  format: ['esm'],
  dts: { generator: 'oxc' },
  clean: true,
  deps: { alwaysBundle: ['@nx-devkit/internal'] },
});
