# @nx-devkit/dagger

Standalone Nx plugin: any `dagger.json` becomes a project with `dagger call` pipeline targets. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/dagger
```

Depends on `@nx/devkit` `^24`. Requires the `dagger` CLI on `PATH` at run time — see <https://docs.dagger.io/install>. It is never installed or invoked by the plugin at inference time.

## Register

```bash
nx add @nx-devkit/dagger   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/dagger"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger       | dagger.json `functions` | Target(s)                               | Command            | Cacheable |
| ------------- | ----------------------- | --------------------------------------- | ------------------ | --------- |
| `dagger.json` | absent or empty         | `dagger:call`                           | `dagger call`      | no        |
| `dagger.json` | `["build", "test"]`     | `dagger:call:build`, `dagger:call:test` | `dagger call <fn>` | no        |

`dagger functions` can only be listed at run time, so per-function targets require a declared `functions` field in `dagger.json` (a list of names, or a record keyed by name). Function names are shell-quoted before they reach `nx:run-commands`.

Dagger pipelines are side-effectful, so every inferred target is `cache: false`. Inputs stay tracked — the `dagger.json` itself plus the module source — so the project graph and `nx affected` still see edits:

- `source` field declared → `{projectRoot}/<source>/**/*` (a file path tracks the file itself)
- no `source`, `sdk: "go"` → `{projectRoot}/**/*` (Go modules live at the module root)
- no `source`, any other sdk → `{projectRoot}/src/**/*`

`dagger.json`'s `name` becomes the Nx project name when the directory has no `package.json` of its own.

## Options

```jsonc
// nx.json
{
  "plugins": [{ "plugin": "@nx-devkit/dagger", "options": { "targetPrefix": "pipeline" } }],
}
```

`targetPrefix` (default `dagger`) renames the inferred targets — e.g. `pipeline:call:build`.

## Inspect

```bash
npx nx show project my-module            # see inferred targets
npx nx run my-module:dagger:call         # run dagger call
npx nx run my-module:dagger:call:build   # run a declared function
```
