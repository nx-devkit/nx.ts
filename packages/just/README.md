# @nx-devkit/just

Standalone Nx plugin: every `justfile`/`JUSTFILE`/`.justfile`/`just.just` becomes a set of `just:<recipe>` targets on the owning project — run a justfile through Nx, no `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/just
```

Depends on `@nx/devkit` `^24`. Requires the [`just`](https://just.systems) binary on `PATH` when targets run — it is a system tool, not an npm package, so nothing is installed for you.

## Register

```bash
nx add @nx-devkit/just   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/just"] }
```

## What it infers

| justfile construct                     | Nx target                         | Command                  |
| -------------------------------------- | --------------------------------- | ------------------------ |
| `build:`                               | `just:build`                      | `just build`             |
| `build target="release":`              | `just:build` (params in metadata) | `just build`             |
| `@quiet:`                              | `just:quiet`                      | `just quiet`             |
| `mod tools` → `check:` in `tools.just` | `just:tools::check`               | `just tools::check`      |
| `alias b := build`                     | `just:b`                          | `just b`                 |
| `a: b c`                               | `just:a` + `dependsOn`            | `just a`                 |
| `_helper:` / `[private]`               | — (skipped)                       | —                        |
| `a: b && c`                            | `just:a`, depends on `b` only     | subsequent deps excluded |

- Recipes run via `nx:run-commands` with `cwd: {projectRoot}` — the directory containing the justfile, exactly how `just` resolves it.
- Prior dependencies (`a: b c`) map to `dependsOn`; subsequent (`&&`) deps and parenthesized args `(dep arg)` are handled — the dep name is extracted, args are not forwarded.
- `mod`/`mod?` statements are followed when the source file resolves (`foo.just`, `foo.mod.just`, `foo/mod.just`, `foo/justfile`, `foo/.justfile`, or an explicit `mod foo 'path'`). Module recipes become `<mod>::<recipe>` targets; missing optional (`mod?`) sources are skipped silently. Recursion depth is capped and cycles are deduped.
- Parameterized recipes get a `metadata.description` noting their params; pass values after `--`, e.g. `nx run my-app:just:build -- debug`.
- Targets are **never cached** — recipe side effects are unknown; add caching yourself in `targetDefaults` if wanted.
- `import` statements and `set`/`export`/assignment lines are not followed.

## Options

```jsonc
// nx.json
{ "plugins": [{ "plugin": "@nx-devkit/just", "options": { "targetPrefix": "just:" } }] }
```

`targetPrefix` is prepended to every target name (default `just:`).

## Inspect

```bash
npx nx show project my-app          # see inferred targets
npx nx run my-app:just:build        # run `just build` in the justfile dir
npx nx run-many -t just:test        # run the `test` recipe across every project
npx nx run my-app:just:build -- dev # pass args to a parameterized recipe
```
