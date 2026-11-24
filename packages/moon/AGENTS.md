# @nx-devkit/moon

Agent guide for working in `packages/moon/`. Touch ONLY this directory
unless the bead body says otherwise.

## What this package does

A `moon.yml` describes a moonrepo project: its tasks, file groups, env,
and project metadata. This plugin turns every `tasks:` entry into an Nx
target on the project that owns the file, so a consumer can drop the
plugin into an existing moon workspace and keep `moon.yml` as the source
of truth. `moon` itself is never invoked — inferred targets run the
task's `command`/`script` via `nx:run-commands` in `{projectRoot}`
(`node_modules/.bin` lands on PATH via npm-run-path).

| moon concept                                                     | Nx concept                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `tasks.<name>`                                                   | target `<name>` (or `<targetPrefix><name>`)             |
| `command`/`script`/`args`                                        | `options.command` (script supersedes; arrays join ' ')  |
| no command                                                       | `nx:noop` aggregator                                    |
| `deps: 'task'` / `~:task`                                        | `{ target: 'task' }` (self)                             |
| `deps: '^:task'` / `^task`                                       | `{ target: 'task', dependencies: true }`                |
| `deps: 'proj:task'`                                              | `{ target: 'task', projects: ['proj'] }`                |
| `#tag:task`, `:task`, `proj:#tag`                                | dropped — no Nx dependsOn equivalent                    |
| `inputs`/`outputs`                                               | `{projectRoot}`/`{workspaceRoot}` filesets, `!` kept    |
| `$VAR` input                                                     | `{ env: 'VAR' }` input (wildcards dropped)              |
| `@group(x)`/`group://x`                                          | resolved against local `fileGroups:` (depth-capped)     |
| `file://`/`glob://`/`{file,glob}`                                | unwrapped to the path; `project://`/`{project}` dropped |
| missing `inputs`                                                 | `{projectRoot}/**/*` (moon default)                     |
| `options.persistent`/`preset:server`/`dev`,`start`,`serve` names | `continuous: true` + `cache: false`                     |
| `preset: utility` / `local: true` / `options.cache: false`       | `cache: false`                                          |
| `options.cache: local`/`remote`                                  | `cache: true` (Nx has no local/remote split)            |
| task `env` + project `env`                                       | `options.env` (project first, task wins)                |
| `options.envFile` string/list                                    | `options.envFile` = first file (workspace-rel) + inputs |
| `options.envFile: true`                                          | the 6-file moon chain as inputs only                    |
| `id` / string `project:`                                         | project `name`                                          |
| `project:` block                                                 | `metadata.moon.project`                                 |
| `tags`                                                           | project `tags`                                          |
| `type: application`/`library`                                    | `projectType` (other kinds unset)                       |
| `dependsOn`                                                      | `implicitDependencies`                                  |
| `.moon/workspace.*`/`.moon/toolchain.*`                          | `{workspaceRoot}` inputs + `metadata.moon`              |

## File layout

```text
packages/moon/
├── package.json
├── tsdown.config.ts        # entries: index, plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── generators.json         # @nx-devkit/moon:init
├── src/
│   ├── index.ts            # re-exports createNodesV2 + helpers
│   ├── plugin.ts           # createNodesV2 — '**/moon.{yml,yaml}'
│   ├── plugin.spec.ts
│   ├── moon-config.ts      # moon.yml types + YAML parse
│   ├── moon-config.spec.ts
│   ├── workspace.ts        # .moon/workspace.* + .moon/toolchain.* detection
│   ├── workspace.spec.ts
│   ├── targets.ts          # moon task → TargetConfiguration
│   ├── targets.spec.ts
│   ├── types.ts            # NxDevkitMoonOptions { targetPrefix? }
│   └── generators/init/    # register the plugin (no peer deps)
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitMoonOptions {
  targetPrefix?: string; // default '' — moon task names are already qualified
}
```

## Invariants

- **Glob is `**/moon.{yml,yaml}`** — moon supports both extensions.
- **A stray moon.yml still infers** — `.moon/workspace.*` is NOT required;
  its presence only adds inputs + `metadata.moon` (`toolchain.*` is
  metadata only, never parsed).
- **No moon peer dep.** The plugin reads moon.yml; `command`/`script`
  run verbatim via `nx:run-commands`. `nx:noop` for command-less
  (aggregator) tasks.
- **`projects: "self"|"dependencies"` strings are banned** — Nx 24 throws
  on them; use `{ target }` and `{ target, dependencies: true }`.
- **A broken moon.yml must not break the project graph** — warn + skip.
- **moon.yml is always an input** (`{workspaceRoot}/<path>`) so config
  edits re-hash tasks; detected `.moon/*` files ride along.
- **`envFile` asymmetry**: nx:run-commands throws on a missing envFile,
  moon tolerates `envFile: true` candidates — `true` never sets the
  option, only inputs. String/list forms set the first file.
- **`jsonc-parser` must stay a dependency** — `@nx-devkit/internal` is
  bundled into the generator chunk and imports it (same fix as
  `a90b406`, noted in packages/prisma).
- **`yaml` must stay a dependency** — moon.yml is YAML; parsing is
  strict — a non-map document throws.

## Gotchas

- `CreateNodesResult` cannot emit `targetDefaults`/`namedInputs` (Nx 24)
  — `.moon/*` files fold into per-target `inputs` instead.
- moon defaults missing `inputs` to `**/*`; the plugin emits
  `{projectRoot}/**/*` rather than Nx `default` to match exactly.
- `.moon/tasks/*` global task inheritance is NOT merged — only the local
  `tasks:` map is read (documented limitation).
- `$projectRoot`/`$workspaceRoot` token variables in commands are
  substituted; all other moon tokens pass through verbatim.
- `dependsOn`/`inputs`/`outputs` object and URI forms (`group://`,
  `project://`, `{file|glob|group|project}`) are all handled —
  `project://` and unknown `@token()`s are dropped with a debug log.

## Extending

| Task                         | Where                                        |
| ---------------------------- | -------------------------------------------- |
| new task field mapping       | `moon-config.ts` (`MoonTask`) + `targets.ts` |
| new dep scope                | `targets.ts` (`parseDepTarget`)              |
| new input/output source form | `targets.ts` (`mapPatternString`)            |
| plugin options               | `types.ts` + `plugin.ts` callback            |

## Scope rules

- Touch ONLY `packages/moon/`.
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
cd packages/moon
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```
