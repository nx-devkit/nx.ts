# @nx-devkit/turbo

Agent guide for working in `packages/turbo/`. Touch ONLY this directory
unless the bead body says otherwise.

## What this package does

A `turbo.json` describes the task graph of a Turborepo. This plugin turns
every `tasks` (v2) / `pipeline` (v1) entry into an Nx target on each
workspace package whose `package.json` declares the matching `scripts`
entry — so a consumer can drop the plugin into an existing turbo repo and
keep `turbo.json` as the source of truth.

| turbo concept                    | Nx concept                                        |
| -------------------------------- | ------------------------------------------------- |
| root `turbo.json` task           | target on every package with the matching script  |
| `//#task` key                    | target on the root project (`root: ''`)           |
| `pkg#task` key                   | target on that package's project only             |
| nested `<dir>/turbo.json`        | targets on `<dir>`'s own package (overrides root) |
| `^task` dependsOn                | `{ target, dependencies: true }`                  |
| `task` dependsOn                 | `{ target }` (self)                               |
| `pkg#task` / `//#task` dep       | `{ target, projects: [name] }`                    |
| `persistent: true`               | `continuous: true` + `cache: false`               |
| `env`/`passThroughEnv`/`global*` | `{ env: VAR }` / `{workspaceRoot}` inputs         |

## File layout

```text
packages/turbo/
├── package.json
├── tsdown.config.ts        # entries: index, plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── generators.json         # @nx-devkit/turbo:init
├── src/
│   ├── index.ts            # re-exports createNodesV2 + helpers
│   ├── plugin.ts           # createNodesV2 — '**/turbo.json'
│   ├── plugin.spec.ts
│   ├── turbo-config.ts     # turbo.json types + parse (tasks ?? pipeline)
│   ├── workspace.ts        # workspace package discovery + globs
│   ├── workspace.spec.ts
│   ├── targets.ts          # turbo task → TargetConfiguration
│   ├── targets.spec.ts
│   ├── types.ts            # NxDevkitTurboOptions (empty, reserved)
│   └── generators/init/    # register the plugin (no peer deps)
├── README.md
└── AGENTS.md
```

## Options interface

```ts
// The plugin currently ships no options; the createNodesV2 signature is parameterless.
export interface NxDevkitTurboOptions {} // {} reserved for future options
```

## Invariants

- **Script gate.** A task only lands on a package whose `package.json`
  declares `scripts.<task>` — turbo's own rule. Plain tasks NEVER apply
  to the root package; `//#` requires a named root package.json.
- **`projects: "self"|"dependencies"` are banned strings.** Nx 24 throws on
  them — use `{ target }` (self) and `{ target, dependencies: true }`.
- **Nested config wins.** Results are emitted root-first so a
  package-level turbo.json merges after the root config and overrides the
  same-named target.
- **A broken turbo.json must not break the project graph** — warn + skip.
- **No turbo peer dep.** The plugin reads `turbo.json`; inferred targets
  run the script via `nx:run-script` — `turbo` is never invoked.
- **`turbo.json` is always an input** (`{workspaceRoot}/<path>`) so config
  edits re-hash tasks.

## Gotchas

- `CreateNodesResult` cannot emit `targetDefaults`/`namedInputs` —
  `global*` fields fold into per-target `inputs` instead.
- turbo caches no file outputs when `outputs` is absent — the plugin
  emits `outputs: []` rather than inventing a dist/build default.
- `$TURBO_DEFAULT$` in `inputs` maps to the `default` named input.
- `pnpm-workspace.yaml` is parsed line-wise (no YAML dep) — only the
  top-level `packages:` list form (and inline `[a, b]` form) is read.

## Extending

| Task                     | Where                                          |
| ------------------------ | ---------------------------------------------- |
| new task field mapping   | `turbo-config.ts` (`TurboTask`) + `targets.ts` |
| new workspace source     | `workspace.ts` (`readWorkspacePatterns`)       |
| dependsOn selector shape | `targets.ts` (`mapDependsOn`)                  |
| plugin options           | `types.ts` + `plugin.ts` callback              |

## Scope rules

- Touch ONLY `packages/turbo/`.
- Do NOT modify other plugin packages or the root `nx.json` — dogfooding
  registration is a separate dedicated task.

## TDD workflow

1. Write failing specs (`src/**/*.spec.ts`, tmp dirs via `mkdtempSync`).
2. `bun run test` → RED.
3. Implement to GREEN.
4. `bun run build`.
5. `npx tsc --noEmit -p tsconfig.json` — tsdown does not typecheck.
6. Commit.

## Verification commands

```bash
cd packages/turbo
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```
