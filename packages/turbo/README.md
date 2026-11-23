# @nx-devkit/turbo

Standalone Nx plugin: a `turbo.json` becomes the task graph — run a
Turborepo on Nx **without migration**. `turbo.json` stays the single
source of truth; Nx adds `run-many`, `affected`, computation caching,
Nx Cloud and `nx graph`. No `project.json` needed — and `turbo` itself
is never invoked (not even a peer dependency).

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/turbo
```

Depends on `@nx/devkit` `^24` (installed automatically).

## Register

```bash
nx add @nx-devkit/turbo   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/turbo"] }
```

## What it infers

Every entry in `tasks` (turbo v2) or `pipeline` (turbo v1) becomes an Nx
target on every workspace package whose `package.json` declares a
`scripts` entry of the same name — the exact rule turbo itself applies.
Each inferred target runs the script via `nx:run-script`, so the script
is unchanged and runs in the package directory.

<!-- target mapping consistent with src/targets.ts -->

| turbo.json field                     | Nx target field                                                             |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `tasks` / `pipeline`                 | one target per entry                                                        |
| `dependsOn: ["^build"]`              | `dependsOn: [{ target: "build", dependencies: true }]`                      |
| `dependsOn: ["build"]`               | `dependsOn: [{ target: "build" }]` (same project)                           |
| `dependsOn: ["docs#lint"]`           | `dependsOn: [{ target: "lint", projects: ["docs"] }]`                       |
| `dependsOn: ["//#gen"]`              | `dependsOn: [{ target: "gen", projects: ["<root package name>"] }]`         |
| `inputs`                             | `inputs` — `src/**` → `{projectRoot}/src/**`, `$TURBO_DEFAULT$` → `default` |
| `outputs`                            | `outputs` — `dist/**` → `{projectRoot}/dist/**` (`!` kept)                  |
| (no `outputs`)                       | no file outputs — turbo caches nothing without a declaration                |
| `cache: false`                       | `cache: false` (default `true`)                                             |
| `env` / `passThroughEnv`             | `{ env: "VAR" }` hash inputs                                                |
| `dotEnv`                             | `{projectRoot}/<file>` inputs                                               |
| `persistent: true`                   | `continuous: true` + `cache: false`                                         |
| `globalDependencies`                 | `{workspaceRoot}/<glob>` inputs on every target                             |
| `globalDotEnv`                       | `{workspaceRoot}/<file>` inputs on every target                             |
| `globalEnv` / `globalPassThroughEnv` | `{ env: "VAR" }` inputs on every target                                     |
| task key `//#task`                   | target on the **root** project (needs `scripts.<task>` + `name`)            |
| task key `pkg#task`                  | target on that package only                                                 |

The originating `turbo.json` is always added as a `{workspaceRoot}/…`
input, so editing the config re-hashes every task it defines.

Package-level `turbo.json` files (`extends: ["//"]`) apply their tasks to
the owning package only and override the root-inferred task of the same
name.

> `CreateNodesResult` cannot emit `targetDefaults`/`namedInputs` in Nx
> 24 — the `global*` fields are folded into each target's `inputs`
> instead, which is hash-equivalent.

## turbo → Nx command map

| turbo                               | Nx                                                                 |
| ----------------------------------- | ------------------------------------------------------------------ |
| `turbo run build`                   | `nx run-many -t build`                                             |
| `turbo run build --filter=docs`     | `nx run-many -t build --projects=docs`                             |
| `turbo run build --filter=docs...`  | `nx run-many -t build --projects=docs` (deps come via `dependsOn`) |
| `turbo run test --filter=...[HEAD]` | `nx affected -t test`                                              |
| `turbo run build --dry=json`        | `nx run-many -t build --dryRun`                                    |

## Out of scope

turbo features with no Nx counterpart are ignored on purpose: `with`,
`watch`, `daemon`, `ui`, `remoteCache`, `envMode`, `interactive`,
`interruptible`, `outputLogs`. `turbo prune` and `--filter` selectors
(`{dir}`, `...`, `^`, `[commit]`, `--affected`) are replaced by Nx
`--projects` globs/tags and `nx affected`.

## Workspace package discovery

Package dirs are resolved from, in precedence order:

1. `workspaces` in the root `package.json` (array or `{ packages }`)
2. `packages:` in `pnpm-workspace.yaml`
3. `packages` in `lerna.json`
4. fallback: `packages/*` + `apps/*`

Globs support `*`, `?`, `**` and `!` negations; `node_modules` and
hidden directories are never scanned.

## Inspect

```bash
npx nx show projects
npx nx show project <name>
npx nx run <name>:build
```

## Skip rules

- `turbo.json` under `node_modules` or outside the workspace is ignored.
- A `turbo.json` that cannot be parsed is warned about and skipped — it
  never breaks the project graph.
- A nested `turbo.json` without a sibling `package.json` is skipped.
- Tasks only land on packages that declare the matching `scripts` entry.

## Options

None. Behavior is entirely file-driven.

## License

MIT
