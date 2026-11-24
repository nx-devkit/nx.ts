# Proposal: turbo-plugin

## Why

A Turborepo should become an Nx workspace **without migration**: register
one plugin and `turbo.json` stays the single source of truth while Nx
provides `run-many`, `affected`, computation caching, Nx Cloud and
`nx graph`. No official bridge exists and nothing on npm does this today —
it is the highest-leverage adoption play for the devkit.

## What changes

- New package `@nx-devkit/turbo` under `packages/turbo/`.
- `createNodesV2` watches `**/turbo.json`: the root config and
  package-level configs. A nested config applies its tasks to the owning
  package only; when its `extends` includes `//` (turbo's Package
  Configuration marker), the root config's `global*` inputs and the root
  `turbo.json` itself fold into that package's target inputs.
- Every entry in `tasks` (turbo v2) or `pipeline` (v1) becomes an inferred
  Nx target on every workspace package whose `package.json` carries a
  matching `scripts` entry — identical to turbo's own semantics. Targets
  run through `nx:run-script`, so the script itself stays untouched.
- `dependsOn` mapping:
  - `"^build"` → `{ target: "build", dependencies: true }`
  - `"build"` → `{ target: "build" }` (same project)
  - `"pkg#build"` → `{ target: "build", projects: ["pkg"] }`
  - `"//#task"` → `{ target: "task", projects: ["<root package name>"] }`
- `outputs`/`inputs` map to Nx `outputs`/`inputs` (`$TURBO_DEFAULT$` →
  `{projectRoot}/**/*`, `$TURBO_ROOT$/x` → `{workspaceRoot}/x`); `cache:
  false` is honored; `env`/`globalEnv` become `{ env: "VAR" }` hash
  inputs while `passThroughEnv`/`globalPassThroughEnv` stay out of the
  cache key like in turbo; `globalDependencies`/`globalDotEnv`/`dotEnv`
  become file inputs; `persistent: true` → `continuous: true` +
  `cache: false`.
- `//#task` keys create targets on the root project; `<package>#<task>`
  keys create per-package target overrides that always win over the
  same-named plain task for that package.
- Workspace packages are discovered from `workspaces` (package.json),
  `pnpm-workspace.yaml` (`packages:`), or `lerna.json` (`packages`), with a
  `packages/*` + `apps/*` fallback.
- New generator `@nx-devkit/turbo:init` registers the plugin in `nx.json`.

## Non-goals

- No `createDependencies` — Nx already builds the package graph from
  `package.json` dependency declarations, which is what turbo's `^`
  dependsOn resolves against.
- No targetDefaults/namedInputs emission — `CreateNodesResult` cannot
  express them in Nx 24; `globalDependencies`/`globalEnv` are folded into
  each inferred target's `inputs` (equivalent hash semantics).
- `with`, `watch`, `daemon`, `ui`, `remoteCache`, `envMode` and
  `interruptible` have no Nx counterpart — out of scope, documented in the
  README.
- turbo `--filter` syntax — consumers use `nx run-many --projects` /
  `nx affected`; a mapping table lives in the README.
- Root `nx.json` registration — dogfooding is a separate dedicated task.
