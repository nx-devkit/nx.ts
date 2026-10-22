# @nx-devkit/sverka

Agent guide for working in `packages/sverka/`. Touch ONLY this directory
unless the bead body says otherwise.

## What this package does

A sverka config (`sverka.config.ts`) describes a workflow: pipelines with
steps and entries. This plugin turns every step into **its own Nx target**
with its own inputs, outputs and cache entry — instead of one target that
runs the whole workflow.

| sverka concept | Nx concept |
|---|---|
| config file | project root (the config's directory) |
| pipeline + step (`ci/lint`) | target `ci:lint` |
| step dependency | `dependsOn` |
| step output | target `outputs` |
| consumed artifact | target `inputs` |
| — | `cache: true` per target |

## File layout

```text
packages/sverka/
├── package.json
├── tsdown.config.ts        # entries: plugin, index, executors/step, generators/*
├── vitest.config.ts
├── tsconfig.json
├── executors.json          # @nx-devkit/sverka:step
├── generators.json         # @nx-devkit/sverka:init, :config
├── src/
│   ├── plugin.ts           # createNodesV2 — config → one target per step
│   ├── plugin.spec.ts
│   ├── types.ts            # NxDevkitSverkaOptions
│   ├── graph.ts            # config discovery + Definition Graph loading
│   ├── plan.ts             # entries, reachable steps, dependencies
│   ├── paths.ts            # stable artifact/value paths
│   ├── targets.ts          # step → Nx target (inputs/outputs/dependsOn)
│   ├── config-hooks.ts     # @sverka/* resolve fallback
│   ├── executors/step/     # executor.ts, bridge.ts, schema.json
│   └── generators/
│       ├── init/           # register the plugin, install peer deps
│       └── config/         # generate a sverka.config.ts from the project
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitSverkaOptions {
  entry?: string      // default: every entry in the config
  targetName?: string // default: "{pipeline}:{step}"
  inputs?: string[]   // extra input globs for every target
  cache?: boolean     // default: true
}
```

Every option MUST be honored by the `createNodesV2` callback — an option
that is declared but ignored is drift (see `REVIEW.md`).

## The data flow

```text
sverka.config.ts
   │  dynamic import() (Node type stripping) + synthesize()
   ▼
DefinitionGraph ──► collectEntries() ──► stepsForEntry()   (reachable steps)
   │                                                    │
   │                                            buildStepTarget()
   ▼                                                    ▼
target ci:lint { executor, inputs, outputs, dependsOn, cache }
   │
   ▼  nx run app:ci:lint
@nx-devkit/sverka:step executor
   │  bind a single-step plan → sverka engine (host driver)
   │  bridge: materialize imported artifacts, read producer values
   │  run → publish own artifacts/values to stable paths
   ▼
.sverka/artifacts/<stepId>/…   (declared as the target's outputs)
```

## Invariants

- **One target per step.** Never collapse the steps of a config into a
  single "run the workflow" target — the whole point of the package is that
  each step is cached and scheduled on its own.
- **The executor runs exactly one step.** The sverka engine gets a plan with
  a single step; the step's `dependencies` are dropped because Nx already
  ran the producing tasks.
- **Stable output paths.** The engine's artifact store is per-run, so the
  executor copies artifacts and values to `<projectRoot>/.sverka/artifacts/…`
  (`paths.ts`). Those paths are what the target declares as outputs.
- **No self-invalidation.** A file a step writes into the project is an
  input of every step of the config — the plugin excludes the declared
  outputs, the imported artifacts and the shell redirect targets of *all*
  steps (`collectProjectWrites`).
- **A broken config must not break the project graph.** The plugin warns and
  skips a config it cannot load.
- **The consumed artifact is hashed twice on purpose:** as a file glob (its
  content is part of the consumer's hash) and as `dependentTasksOutputFiles`
  (the producer's task hash is folded into the consumer's).

## Gotchas

- **The engine's run id is random.** `<artifactDir>/<runId>/<stepId>/<output>`
  — never usable as an Nx output path. Always go through `paths.ts`.
- **The step's scratch space lives in the project.** The engine writes
  `<projectRoot>/.sverka/workspace/<stepId>/.outputs` — it changes on every
  run and MUST stay excluded from the inputs.
- **`expandOutputs` (Nx) skips nothing** — a hidden output directory
  (`.sverka/…`) is cached and restored like any other path, but the *inputs*
  must exclude it explicitly or the cache never hits.
- **The config is TypeScript.** Node strips the types (>= 22.18). A project
  without `"type": "module"` gets a `MODULE_TYPELESS_PACKAGE_JSON` warning
  on every run — harmless, but noisy.
- **The daemon caches modules.** `graph.ts` appends the config's mtime to
  the import URL so an edited config is re-evaluated instead of served from
  the ESM cache.
- **`jsonc-parser` must stay a dependency.** `@nx-devkit/internal` is
  bundled (`alwaysBundle`), and tsdown only externalizes *declared*
  dependencies — without it, jsonc-parser is inlined into the chunk and
  its internal `require("./impl/*")` calls break at runtime (the same fix
  as `a90b406`).

## Extending

| Task | Where |
|---|---|
| new target naming | `types.ts` (`DEFAULT_TARGET_NAME`) + `targets.ts` (`targetNameFor`) |
| new input/output mapping | `targets.ts` (`buildStepTarget`) + `paths.ts` |
| new executor option | `executors/step/schema.json` + `schema.d.ts` + `executor.ts` |
| new GitHub check | `generators/config/github-checks.ts` (+ a `sh -n` test) |
| new sverka config name | `graph.ts` (`SVERKA_CONFIG_NAMES`) + the glob in `plugin.ts` |

## Scope rules

- Touch ONLY `packages/sverka/`.
- Do NOT modify other plugin packages — except adding `packages/sverka` to
  the root `nx.json` (`plugins` + `release.projects`) when the bead covers
  package onboarding.

## TDD workflow

1. Write the failing spec (`src/**/*.spec.ts`, tmp dirs via `mkdtempSync`).
2. `bun run test` → RED.
3. Implement to GREEN.
4. `bun run build`.
5. `npx tsc --noEmit -p tsconfig.json` — tsdown does not typecheck.
6. Commit.

## Verification commands

```bash
cd packages/sverka
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```

## Consumer commands

The project name comes from the `package.json` name, and falls back to the
project path when the project has no `package.json`:

```bash
nx run <project>:ci:lint          # a step
nx run --project=<project> --target=ci:lint   # the explicit form
```
