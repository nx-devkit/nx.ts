# Proposal: playwright plugin

## Why

Browser e2e is the largest gap left in the plugin matrix. A `playwright.config.*`
file is an unambiguous signal — a project that keeps one wants `playwright test`
to run, cached, under Nx.

## What

New standalone package `@nx-devkit/playwright`:

- `createNodesV2` on `**/playwright.config.{ts,js,mts,mjs,cjs,cts}` → cached
  `e2e` target (`npx playwright test`, cwd = owning directory) plus uncached
  `e2e:ui` and `e2e:update-snapshots`.
- Cached outputs cover `test-results/`, `playwright-report/`, `blob-report/`.
- Options: `targetName`, `extraTargets`.
- `init` generator, README, AGENTS.
