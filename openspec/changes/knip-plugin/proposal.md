# Proposal: knip plugin

## Why

The plugin matrix covers lint/format/test/build/spec tooling, but there is no
dead-code gate. Knip detects unused exports, files and dependencies and is a
common addition to Nx workspaces — today a consumer must hand-write a
`project.json` target for it.

A knip config (`knip.json`, `knip.ts`, `knip.config.*`) or a `package.json`
with a `"knip"` key is a reliable signal that the owning project wants knip —
so it can be inferred like every other tool in this repo.

## What

New standalone package `@nx-devkit/knip`:

- `createNodesV2` on `**/knip.{json,jsonc,ts}` + `knip.config.*` +
  `package.json` → cached `knip` target (`npx knip`, cwd = owning directory)
  and uncached `knip:fix` (`npx knip --fix`).
- `package.json` only triggers when it contains a `"knip"` key.
- Options: `targetName`, `fixTarget`.
- `init` generator (JSONC-preserving `nx.json` registration), README, AGENTS.
