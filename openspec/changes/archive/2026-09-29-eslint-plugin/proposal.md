# Proposal: eslint plugin

## Why

ESLint is covered today only as a lint fallback inside the typescript preset.
A standalone `@nx-devkit/eslint` lets consumers adopt just the linter — the
same shape `@nx-devkit/oxlint` and `@nx-devkit/biome` already provide.

## What

New standalone package `@nx-devkit/eslint`:

- `createNodesV2` on `**/eslint.config.{js,mjs,cjs,ts,mts,cts}` (flat config)
  → cached `lint` target (`npx eslint .`, cwd = owning directory) plus
  uncached `lint:fix` (`npx eslint . --fix`).
- Options: `targetName`, `fixTarget`.
- `init` generator, README, AGENTS.
