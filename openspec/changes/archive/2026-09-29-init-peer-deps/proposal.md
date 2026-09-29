# Proposal: init-peer-deps

## Why

Standalone plugin init generators (`nx add @nx-devkit/<plugin>`) register the plugin in `nx.json` but leave the tool itself uninstalled — the inferred target then fails with `command not found` on first run. The typescript preset already installs missing dev deps; standalone plugins should do the same.

## What changes

- `@nx-devkit/internal` gains `installPeerDeps(tree, deps)` — filters deps already declared and returns an `addDependenciesToPackageJson` callback.
- Every standalone plugin init generator declares its peer tool version and installs it when missing: biome, commitlint, cspell, eslint, knip, markdownlint, openspec, oxlint, playwright, vitest.
- `packages/internal` gets a `vitest.config.ts` + `test` script so its specs (existing `jsonc.spec.ts`, new `init-generator.spec.ts`) actually run.

## Non-goals

- typescript-preset keeps its own rule-based installer (`getMissingDevDeps`) — it installs conditionally on detected configs, a superset of this generic helper.
- No version-range negotiation — the plugin's declared peer range is authoritative.
