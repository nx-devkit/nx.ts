# @nx-devkit/moon

Standalone Nx plugin: a `moon.yml` becomes the task definition — run a
moonrepo workspace on Nx **without migration**. `moon.yml` stays the
single source of truth; Nx adds `run-many`, `affected`, computation
caching, Nx Cloud and `nx graph`. No `project.json` needed — and `moon`
itself is never invoked (not even a peer dependency).

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/moon
```

Depends on `@nx/devkit` `^24` (installed automatically).

## Register

```bash
nx add @nx-devkit/moon   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/moon"] }
```

## What it infers

Every entry in a project-level `moon.yml` `tasks:` map becomes an Nx
target on the project that owns the file. Each inferred target runs the
task's `command` (or `script`, which supersedes it) via
`nx:run-commands` in the project directory — `node_modules/.bin` is on
PATH, so bare binary names resolve like they do under moon's toolchain.
A task with no command is a dependency aggregator and runs `nx:noop`.

A stray `moon.yml` still infers even without `.moon/workspace.*` — it is
a project file. When `.moon/workspace.{yml,yaml}` or
`.moon/toolchain.{yml,yaml}` exists at the workspace root it is folded
into every target's inputs and reported under `metadata.moon`
(toolchain.yml is read for metadata only).

<!-- target mapping consistent with src/targets.ts -->

| moon.yml field                                                                   | Nx target field                                                               |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `tasks`                                                                          | one target per entry (`nx:run-commands`, or `nx:noop` when no command)        |
| `command` / `script`                                                             | `options.command` — `script` wins; arrays join with spaces                    |
| `args`                                                                           | appended to the command                                                       |
| `deps: ['task']` / `~:task`                                                      | `dependsOn: [{ target: 'task' }]` (same project)                              |
| `deps: ['^:task']` / `^task`                                                     | `dependsOn: [{ target: 'task', dependencies: true }]`                         |
| `deps: ['proj:task']`                                                            | `dependsOn: [{ target: 'task', projects: ['proj'] }]` — id resolved to name   |
| `inputs`                                                                         | `inputs` — `src/**` → `{projectRoot}/src/**`, `/x` → `{workspaceRoot}/x`      |
| `$VAR` input                                                                     | `{ env: 'VAR' }` hash input (`$VAR_*` wildcards dropped)                      |
| `@group(name)` / `group://name`                                                  | resolved against local `fileGroups:`                                          |
| `file://` / `glob://` URIs                                                       | unwrapped to their path (`?query` params dropped)                             |
| `project://id` / `#tag:task`                                                     | dropped — no Nx equivalent                                                    |
| (no `inputs`)                                                                    | `{projectRoot}/**/*` — moon's default fileset                                 |
| `outputs`                                                                        | `outputs` — same glob vocabulary (`!` kept)                                   |
| `options.cache: false`                                                           | `cache: false` (`local`/`remote` map to `true`)                               |
| `local: true` (deprecated)                                                       | `cache: false`                                                                |
| `options.persistent: true` / `preset: server` / task named `dev`/`start`/`serve` | `continuous: true` + `cache: false`                                           |
| `preset: utility`                                                                | `cache: false`                                                                |
| `env` (task + project level)                                                     | `options.env` (project env applies to every task, task env wins)              |
| `options.envFile: '<path>'`                                                      | `options.envFile` + the file as an input                                      |
| `options.envFile: ['a', 'b']`                                                    | `options.envFile` = first entry (workspace-relative) + every file as an input |
| `options.envFile: true`                                                          | the 6-file moon `.env` chain as inputs only — nx fails on a missing envFile   |
| `id` / `project: '<name>'`                                                       | project `name`                                                                |
| `tags`                                                                           | project `tags`                                                                |
| `type: application`/`library`                                                    | `projectType`                                                                 |
| `dependsOn` (project level)                                                      | `implicitDependencies` — makes `^:task` resolve on real graph edges           |
| `project:` metadata block                                                        | `metadata.moon.project`                                                       |

The originating `moon.yml` is always added as a `{workspaceRoot}/…`
input, so editing the config re-hashes every task it defines. An
explicit `options.persistent: false` overrides the `preset: server` /
`dev`/`start`/`serve` name default — the task stays non-continuous
(the server preset still disables caching).

`$projectRoot`/`$workspaceRoot` token variables inside `command`/`script`
are substituted (`$projectRoot` → `.`, `$workspaceRoot` → the relative
path up). Other moon tokens inside commands pass through verbatim.

## moon → Nx command map

| moon                 | Nx                     |
| -------------------- | ---------------------- |
| `moon run build`     | `nx run-many -t build` |
| `moon run app:build` | `nx run app:build`     |
| `moon ci`            | `nx affected`          |
| `moon run :lint`     | `nx run-many -t lint`  |

## Out of scope

moon features with no Nx counterpart are ignored on purpose: task
inheritance from `.moon/tasks/*` (`extends` is read but not resolved),
`project://` inputs, dep `args`/`env`/`optional`/`cacheStrategy`/`type`,
tag and all-project scopes, `options` tuning knobs (`outputStyle`,
`runInCI`, `interactive`, `internal`, `retryPolicy`, …), `checks`,
`platform`, `toolchains`, `owners`, `docker`, `envOverride`. Inherited
global tasks are not merged — a project task of the same name always
wins (closest moon semantics available at the file level).

`options.envFile: true` hashes the whole moon `.env` chain as inputs
only. An envFile list hashes every declared file and sets
`nx:run-commands` `envFile` to the first entry — Nx hard-fails on a
missing env file while moon tolerates the whole chain.

## Options

| Option         | Default | Description                                                                                           |
| -------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `targetPrefix` | `''`    | Prefix for inferred target names — e.g. `'moon:'` → `moon:build`. Applied to `dependsOn` targets too. |

moon task names are project-scoped — each `tasks.<name>` is local to its
owning moon.yml — so the default keeps the task's own name. Set
`targetPrefix` when another plugin infers the same target names.

```jsonc
// nx.json
{
  "plugins": [{ "plugin": "@nx-devkit/moon", "options": { "targetPrefix": "moon:" } }],
}
```

## Skip rules

- `moon.yml` under `node_modules` or escaping the workspace is ignored.
- A `moon.yml` that cannot be parsed is warned about and skipped — it
  never breaks the project graph.
- A `moon.yml` that maps to nothing (no valid tasks, no metadata) emits
  no project.

## Inspect

```bash
npx nx show projects
npx nx show project <name>
npx nx run <name>:build
```

## License

MIT
