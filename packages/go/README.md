# @nx-devkit/go

Standalone Nx plugin: `go.work` and `go.mod` files become Go module projects with `build`, `test`, `vet`, and `lint` targets — no `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/go
```

Depends on `@nx/devkit` `^24`. Requires the `go` toolchain on `PATH`; the `lint` target additionally needs `golangci-lint` — both are toolchains, not npm dependencies.

## Register

```bash
nx add @nx-devkit/go   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/go"] }
```

## What it infers

Every directory listed in a `go.work` `use` directive that contains a `go.mod` becomes a **workspace member project** (its targets are keyed to the `go.work`, so editing the work file re-infers all members). A `go.mod` directory not claimed by any `go.work` becomes a **standalone project**. The directory holding `go.work` itself is skipped unless it also has a `go.mod`.

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                            | Target  | Command                   | Cacheable |
| ---------------------------------- | ------- | ------------------------- | --------- |
| `go.work` `use` dir / `go.mod` dir | `build` | `go build ./...`          | yes       |
| same                               | `test`  | `go test ./...`           | yes       |
| same                               | `vet`   | `go vet ./...`            | yes       |
| same + `.golangci.{yml,yaml,json}` | `lint`  | `golangci-lint run ./...` | yes       |

Commands run with `cwd` set to the module directory — `go` and `golangci-lint` resolve their module and config context from the working directory, so no flags or paths are interpolated into argv.

Inputs per module: `go.mod`, `go.sum`, `**/*.go`. Workspace members additionally hash `{workspaceRoot}/go.work` and `go.work.sum`; the `lint` target also hashes the `.golangci.*` config that was found (module-local config wins over the workspace-root one).

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/go",
      "options": {
        "lint": false, // disable the golangci-lint target entirely (default: true)
      },
    },
  ],
}
```

## Inspect

```bash
npx nx show projects            # see inferred module projects
npx nx run-many -t build test vet
npx nx run-many -t lint         # golangci-lint where configured
```

## Notes

- `go.mod` files under `node_modules/` or `vendor/` are never treated as modules.
- A `use` dir without a `go.mod` is skipped; a `use` path escaping the workspace is skipped.
- `.golangci.toml` is not watched — the plugin checks `.yml`, `.yaml`, and `.json` only.
