# Proposal: cspell-plugin

## Why

Consumers running cspell in an Nx workspace hand-write `project.json` targets to spell-check per project. A config-driven plugin removes that boilerplate: drop a cspell config into a directory and the owning project gains a cached `spell` target automatically.

## What changes

- New package `@nx-devkit/cspell` under `packages/cspell/`.
- `createNodesV2` watches cspell config files (`cspell` key in `package.json`, `cspell.json`, `.cspell.json`, `cspell.config.*`, `cspell.{yaml,yml}`, `.cspell.{yaml,yml}`).
- Each directory containing a config infers a **cached** `spell` target on the owning project (`nx:run-commands`, `cwd` = project root).
- Options: `targetName` (default `spell`), `args` (default `.`).
- `nx add` init generator registers the plugin via the shared `registerPlugin` helper.

## Non-goals

- No dictionary management — consumers configure cspell itself.
- No automatic peer dependency installation (tracked separately for all plugins).
