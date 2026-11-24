# Proposal: go-plugin

## Why

A Go workspace (single module or a `go.work` multi-module repo) should get
Nx targets without hand-written `project.json`: register one plugin and
`go.work`/`go.mod` stay the single source of truth while Nx provides
`run-many`, `affected`, computation caching, Nx Cloud and `nx graph`.

## What changes

- New package `@nx-devkit/go` under `packages/go/`.
- `createNodesV2` watches `**/{go.work,go.mod,.golangci.{yml,yaml,json}}`
  — lint configs re-trigger inference without becoming module markers.
- Every `use` dir of a `go.work` that contains a `go.mod` becomes a module
  project keyed to the `go.work` file — work-file edits re-infer all
  members, and members hash `go.work`/`go.work.sum` as inputs. The first
  `go.work` (depth, then lexical order) wins a dir claimed by several.
- The directory holding `go.work` is skipped unless it also has a
  `go.mod` (member via `use .`, otherwise standalone).
- A `go.mod` dir not claimed by any `go.work` becomes a standalone
  project keyed to its own `go.mod`.
- Per module: `build` (`go build ./...`), `test` (`go test ./...`), `vet`
  (`go vet ./...`) — all `cache: true` with inputs `go.mod`, `go.sum`,
  and the module fileset minus `vendor`/`node_modules`/`.git` (covers
  `//go:embed` assets and CGo files) — plus `lint` (`golangci-lint run
  ./...`, also cached) when a `.golangci.{yml,yaml,json}` exists in the
  module dir or an ancestor up to the workspace root. Commands run with
  `cwd: '{projectRoot}'` and `GOWORK` pinned to the attributed go.work
  (`off` standalone) so the tool reads the file Nx hashed.
- Plugin option `{ lint?: boolean }` (default `true`) disables lint
  inference entirely when `false`.
- `node_modules`, `vendor`, and `..`-escaping dirs are never modules; a
  broken `go.work` warns/finds nothing and never breaks the graph.
- New generator `@nx-devkit/go:init` registers the plugin in `nx.json`
  (no peer deps — `go`/`golangci-lint` are toolchains, not npm packages).

## Non-goals

- No `createDependencies` — Go module graph edges are resolved by `go`
  itself at build time, not needed for target inference. Consequence for
  `affected`: a library change does not re-run dependents' `test`/`build`
  via Nx edges; workspace members partially compensate by hashing every
  sibling member's sources, but cross-workspace dependents are not
  re-triggered.
- No `go generate`, `go fmt`/`gofmt`, or `go run` targets — the bead
  spec fixes the target set at build/test/vet/lint.
- `.golangci.toml` detection — the spec fixes the watched set at
  `.yml`/`.yaml`/`.json`.
- Root `nx.json` registration — dogfooding is a separate dedicated task.
