# @nx-devkit/taskfile

Agent guide for working in `packages/taskfile/`. Touch ONLY this directory
unless the bead body says otherwise.

## What this package does

A `Taskfile.yml` describes go-task tasks. This plugin turns every
non-internal `tasks:` entry with a shell-safe name into an Nx
`task:<name>` target on the project at the Taskfile's directory — the
target runs `task <name>` so the task CLI keeps owning `cmds`, `vars`,
`env`, `dir:` and dep execution.

| taskfile concept                | Nx concept                                     |
| ------------------------------- | ---------------------------------------------- |
| `tasks: {build: …}`             | `task:build` target on the owning project      |
| `deps: [lint]` / `{task: lint}` | run by `task` itself — no `dependsOn`          |
| `internal: true` task/include   | skipped — not CLI-callable                     |
| `desc:`                         | `metadata.description`                         |
| `includes: {ns: ./dir}`         | `task:ns:<name>` targets, resolved recursively |
| `flatten: true` include         | tasks merge into the parent's namespace        |

## File layout

```text
packages/taskfile/
├── package.json
├── tsdown.config.ts        # entries: plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── generators.json         # @nx-devkit/taskfile:init
├── src/
│   ├── index.ts            # re-exports createNodesV2 + helpers
│   ├── plugin.ts           # createNodesV2 — '**/{Taskfile,taskfile}{.,.dist.}{yml,yaml}'
│   ├── plugin.spec.ts
│   ├── taskfile.ts         # Taskfile types + YAML parse (yaml package)
│   ├── taskfile.spec.ts
│   ├── targets.ts          # task → TargetConfiguration + name safety
│   ├── targets.spec.ts
│   ├── types.ts            # NxDevkitTaskfileOptions {targetPrefix?, cache?}
│   └── generators/init/    # register the plugin (no peer deps — task is a Go binary)
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitTaskfileOptions {
  targetPrefix?: string; // default 'task' → task:<name>; '' = bare name
  cache?: boolean; // default false — arbitrary shell, opt-in only
}
```

## Invariants

- **Uniform command.** Every target runs `task <qualified-name>` via
  `nx:run-commands` with `cwd: '{projectRoot}'` — `cmds` are never
  inlined, so single- and multi-command tasks behave identically.
- **Shell safety.** Task names are untrusted YAML keys interpolated into
  a shell command; anything outside `[\w:.%@+-]` — or a leading `-`,
  which lands as a CLI flag — is skipped with a warn.
- **`internal: true`** tasks produce no target; the task CLI still runs
  them itself when another task deps on them.
- **Deps stay with the task CLI.** `task <name>` executes `deps:`
  itself, so no `dependsOn` is emitted — an Nx edge would run every
  dependency a second time.
- **A broken Taskfile must not break the project graph** — warn + skip.
  Same for unresolvable non-optional includes and include cycles.
- **cache: false default** — task commands are arbitrary; `cache: true`
  is an explicit consumer choice. Target inputs are the `default` named
  input (project sources) plus every contributing Taskfile (matched +
  transitively included) as a `{workspaceRoot}` path, so both source
  edits and config edits bust an opt-in cache.
- **No task peer dep.** go-task is a Go binary on PATH, not npm — the
  init generator installs nothing.
- **One target set per dir** — `Taskfile.yml` wins over `taskfile.yml`
  over `Taskfile.yaml` over `taskfile.yaml`, then the `*.dist.*`
  spellings (the task CLI's own order).

## Gotchas

- An included Taskfile is usually also glob-matched and gets its own
  project targets — `task gen` in `lib/` and `task lib:gen` at the root
  both exist and both work.
- `dir:` on an include is runtime cwd; `task` applies it, so the plugin
  ignores it — commands always run from the including file's project.
- Include resolution probes the same `Taskfile*.yml/yaml` spellings
  inside directories, `*.dist.*` included — the glob watches all of
  them, so an edit to an included dist file re-triggers inference.
- Parses are memoized per plugin run (`parseCache`); the DFS `visiting`
  set owns cycle detection.

## Extending

| Task                   | Where                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| new task field mapping | `taskfile.ts` (`TaskfileTask`) + `targets.ts`                      |
| new include form       | `taskfile.ts` (`TaskfileInclude`) + `plugin.ts` (`resolveInclude`) |
| plugin options         | `types.ts` + `plugin.ts` callback                                  |
| target naming          | `targets.ts` (`targetNameFor`)                                     |

## Scope rules

- Touch ONLY `packages/taskfile/`.
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
cd packages/taskfile
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```
