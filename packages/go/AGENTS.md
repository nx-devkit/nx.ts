# @nx-devkit/go

Agent guide for working in `packages/go/`. Touch ONLY this directory
unless the bead body says otherwise.

## What this package does

`go.work` and `go.mod` describe a Go workspace and its modules. This
plugin turns them into Nx projects: every `use` dir of a `go.work` that
contains a `go.mod` is a workspace member project; a `go.mod` dir not
claimed by any `go.work` is a standalone project.

| go concept                     | Nx concept                                          |
| ------------------------------ | --------------------------------------------------- |
| `go.work` `use` dir + `go.mod` | member project keyed to the go.work config file     |
| `go.mod` dir, unclaimed        | standalone project keyed to its own go.mod          |
| go.work dir itself             | skipped unless it also has a go.mod (`use .`)       |
| `.golangci.{yml,yaml,json}`    | gates the `lint` target (module dir upward to root) |

## File layout

```text
packages/go/
├── package.json
├── tsdown.config.ts        # entries: index, plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── generators.json         # @nx-devkit/go:init
├── src/
│   ├── index.ts            # re-exports createNodesV2 + helpers
│   ├── plugin.ts           # createNodesV2 — '**/{go.work,go.mod,.golangci.*}'
│   ├── plugin.spec.ts
│   ├── gowork.ts           # go.work 'use' parser (line grammar)
│   ├── gowork.spec.ts
│   ├── targets.ts          # module dir → build/test/vet/lint targets
│   ├── targets.spec.ts
│   ├── types.ts            # NxDevkitGoOptions { lint?: boolean }
│   └── generators/init/    # register the plugin (no peer deps)
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitGoOptions {
  lint?: boolean; // infer golangci-lint `lint` target — default true
}
```

## Invariants

- **Trigger glob is `**/{go.work,go.mod,.golangci.{yml,yaml,json}}`** —
  the lint config names re-trigger inference but are never module
  markers.
- **Members are keyed to the go.work file** so work-file edits re-infer
  them; a claimed go.mod emits no result of its own. The first go.work
  (depth, then lexical) wins a contested `use` dir.
- **`go.work` dir itself is skipped** unless it also has a `go.mod`
  (member via `use .`, else standalone).
- **Commands run with `cwd: '{projectRoot}'`** — `go`/`golangci-lint`
  resolve go.work/go.mod/config from the working directory; nothing is
  interpolated into argv. `options.env.GOWORK` pins the attributed
  go.work (absolute path) for members and is `off` for standalone
  modules — `go` only discovers go.work from cwd upward, so sibling
  workspaces and contested claims need the pin to match the hashed file.
- **`build`/`test`/`vet`/`lint` are all `cache: true`** — pure analysis
  over `go.mod`, `go.sum`, and the module fileset minus
  `vendor`/`node_modules`/`.git` (covers `//go:embed` and CGo). Members
  additionally hash `{workspaceRoot}/<go.work>`, the sibling
  `go.work.sum`, and the fileset of every sibling member (workspace
  builds read each other's sources). The root module uses
  `{workspaceRoot}` input prefixes — repo convention for `root: ''`.
- **lint detection**: `.golangci.yml`/`.yaml`/`.json` — the nearest
  config on the ancestor walk from the module dir to the workspace root
  wins (golangci-lint searches upward); the found file is a lint input.
  `.golangci.toml` is intentionally not watched (spec).
- **Skip list**: `node_modules`, `vendor`, and `..`-escaping dirs.
- **A broken go.work must not break the project graph** — the parser is
  total (garbage in → no `use` entries) and file-read failures warn and
  return empty.
- **No go peer dep** — `go`/`golangci-lint` are toolchains, not npm
  packages; the init generator registers the plugin only.

## Gotchas

- `use` paths resolve against the go.work's own directory — a nested
  `a/go.work` with `use ../svc` claims `svc`, not `a/svc`.
- The go.work grammar is line-based: `use ./x`, `use (...)`, `//`
  comments, quoted paths. `replace`/`exclude` blocks are tracked so their
  `old => new` lines are never read as use paths.
- Results are deterministic: members emitted per go.work (sorted), then
  standalone modules sorted by dir — input order does not matter.

## Extending

| Task                   | Where                               |
| ---------------------- | ----------------------------------- |
| new target or command  | `targets.ts` (`buildModuleTargets`) |
| new input              | `targets.ts` (`buildInputs`)        |
| go.work grammar        | `gowork.ts` (`parseGoWork`)         |
| claim/membership rules | `plugin.ts` (claimByDir loop)       |
| plugin options         | `types.ts` + `plugin.ts` callback   |

## Scope rules

- Touch ONLY `packages/go/`.
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
cd packages/go
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```
