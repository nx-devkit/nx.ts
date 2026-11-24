# @nx-devkit/dagger

Agent guide for working in `packages/dagger/`. Touch ONLY this directory unless the bead body says otherwise.

## What this package does

A `dagger.json` marks a Dagger module. The plugin turns it into an Nx
project with `dagger call` targets: one `<prefix>:call:<fn>` per declared
`functions` entry, or a single `<prefix>:call` when none are declared —
`dagger functions` can only be listed at run time, never at inference.

## File layout

```text
packages/dagger/
├── package.json
├── tsdown.config.ts        # entries: index, plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── generators.json         # @nx-devkit/dagger:init
├── src/
│   ├── index.ts            # re-exports createNodesV2 + helpers
│   ├── plugin.ts           # createNodesV2 — '**/dagger.json'
│   ├── plugin.spec.ts
│   ├── dagger-config.ts    # dagger.json types + parse (name/sdk/source/functions)
│   ├── log-safe.ts         # control/bidi-strip sanitizer for log messages
│   ├── targets.ts          # DaggerJson → dagger call TargetConfigurations
│   ├── types.ts            # NxDevkitDaggerOptions { targetPrefix? }
│   └── generators/init/    # register the plugin (no peer deps)
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitDaggerOptions {
  targetPrefix?: string; // default "dagger" → dagger:call, dagger:call:<fn>
}
```

## Invariants

- Trigger glob is `**/dagger.json` only; one project per module dir
  (workspace-root dagger.json → root project `''`).
- **No caching.** Every inferred target is `cache: false` — dagger calls
  run real pipelines — but inputs stay tracked for graph/affected.
- `dagger.json` is always an input (`{workspaceRoot}/<path>`).
- Source inputs: declared `source` wins — when the path exists the
  filesystem decides file vs dir (`{projectRoot}/<source>` vs
  `{projectRoot}/<source>/**/*`); absent paths fall back to the
  basename-contains-a-dot heuristic; `.` or empty means the module root.
  Without `source`: an `sdk` (string or `{"source": …}` object, `runtime`
  accepted as an alias) implies Dagger's `.` default →
  `{projectRoot}/**/*`; no sdk → `{projectRoot}/src/**/*`.
- `name` sets the project name only when the dir has no `package.json`.
- `functions` accepts `string[]` or a record (keys are names). Function
  names are sanitized into target segments and **shell-quoted for the
  running platform** in the command (POSIX single-quote; cmd.exe
  double-quote — names that cannot be quoted safely warn and skip) —
  declared names must never inject shell syntax.
- No dagger npm peer dep — the `dagger` CLI is a system binary; the
  plugin never invokes it.
- A broken dagger.json warns + skips; node_modules and `..`-escaping
  dirs are skipped; output is sorted for determinism.
- `jsonc-parser` must stay a dependency — `@nx-devkit/internal` is
  bundled into the generator chunk and imports it.

## Extending

| Task                     | Where                              |
| ------------------------ | ---------------------------------- |
| new dagger.json field    | `dagger-config.ts` (`DaggerJson`)  |
| target naming / commands | `targets.ts` (`buildCallTargets`)  |
| source-input defaults    | `plugin.ts` (`moduleSourceInputs`) |
| plugin options           | `types.ts` + `plugin.ts` callback  |

## Scope rules

- Touch ONLY `packages/dagger/`.
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
cd packages/dagger
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```
