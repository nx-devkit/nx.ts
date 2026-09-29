# Proposal: commitlint-plugin

## Why

Consumers running commitlint in an Nx workspace hand-write `project.json` targets (or shell scripts) to lint commits per project. A config-driven plugin removes that boilerplate: drop a commitlint config into a directory and the owning project gains a `commitlint` target automatically.

## What changes

- New package `@nx-devkit/commitlint` under `packages/commitlint/`.
- `createNodesV2` watches commitlint config files (cosmiconfig `commitlint` search places: `commitlint` key in `package.json`, `.commitlintrc*`, `commitlint.config.*`).
- Each directory containing a config infers an **uncached** `commitlint` target on the owning project (`nx:run-commands`, `cwd` = project root so auto-discovery picks the local config).
- Options: `targetName` (default `commitlint`), `args` (default `--last`) — covers `--edit` hook usage and `--from`/`--to` CI ranges.
- `nx add` init generator registers the plugin via the shared `registerPlugin` helper.

## Non-goals

- No commit-msg hook installation — consumers wire hooks themselves.
- No automatic peer dependency installation (tracked separately for all plugins).
