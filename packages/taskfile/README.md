# @nx-devkit/taskfile

Standalone Nx plugin: every `Taskfile.yml` becomes `task:*` targets on the owning project — go-task on Nx, no `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/taskfile
```

Depends on `@nx/devkit` `^24`. Requires the `task` binary ([go-task](https://taskfile.dev/installation/)) on `PATH` at run time — it is a Go tool, not an npm peer.

## Register

```bash
nx add @nx-devkit/taskfile   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/taskfile"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                                                   | Target             | Command            | Cacheable   |
| --------------------------------------------------------- | ------------------ | ------------------ | ----------- |
| `{Taskfile.yml,Taskfile.yaml,taskfile.yml,taskfile.yaml}` | `task:<name>`      | `task <name>`      | no (opt-in) |
| same file via `includes: {ns: …}`                         | `task:<ns>:<name>` | `task <ns>:<name>` | no (opt-in) |

Each Taskfile becomes a project at its own directory, and each task a `task:<name>` target running `task <name>` from that directory. The task CLI stays the source of truth — `cmds`, `vars`, `env`, `dir:` and dependency execution all stay with `task`.

- `deps:` entries (string or `{task: name}`) map to `dependsOn` on the same project. A dep declared inside an included file resolves in its own namespace (`lib:build` for a task reached as `lib:*`). Deps on `internal: true` or missing tasks are not emitted — `task` runs internal deps itself.
- `internal: true` tasks and `internal: true` includes are skipped — they are not callable from the CLI.
- `desc:` becomes `metadata.description`.
- `includes:` are followed transitively, including `flatten: true` (merged without a prefix) and `optional: true` (missing files skipped silently). Include cycles are detected and broken.
- When a directory holds several Taskfile spellings, the one `task` would pick wins (`Taskfile.yml` first).
- Targets are never cached by default — task commands are arbitrary shell. Enable via the `cache` option.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/taskfile",
      "options": {
        "targetPrefix": "task", // default — `task:build`; "" emits bare names
        "cache": false, // default — opt into hashing when true
      },
    },
  ],
}
```

## Inspect

```bash
npx nx show project my-app          # see inferred targets
npx nx task:build my-app            # run `task build` in my-app/
npx nx run-many -t task:build       # across every project with a Taskfile
npx nx task:lib:gen my-app          # run a namespaced include task
```
