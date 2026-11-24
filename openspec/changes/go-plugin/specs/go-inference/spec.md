# go-inference

## ADDED Requirements

### Requirement: go.work / go.mod discovery

The plugin SHALL watch `**/{go.work,go.mod}` via `createNodesV2`. A
`go.work` whose `use` entries cannot be read or parsed MUST NOT break the
project graph — the plugin SHALL warn and treat it as claiming nothing.
Directories under `node_modules`, `vendor`, or escaping the workspace via
`..` SHALL be skipped.

#### Scenario: go.work with members

- **GIVEN** `go.work` declares `use ( ./svc ./lib )`
- **WHEN** `svc/go.mod` and `lib/go.mod` exist
- **THEN** projects `svc` and `lib` are inferred from the `go.work` file

#### Scenario: standalone module

- **WHEN** `svc/go.mod` exists and no `go.work` claims `svc`
- **THEN** project `svc` is inferred from `svc/go.mod` itself

#### Scenario: go.work dir without go.mod

- **WHEN** `go.work` sits at the workspace root and `./go.mod` does not
  exist and `use .` is not declared
- **THEN** no root project is inferred for it

#### Scenario: go.work dir with go.mod via `use .`

- **GIVEN** root `go.work` with `use .` and a root `go.mod`
- **THEN** the root project gains module targets as a workspace member

#### Scenario: skipped directories

- **WHEN** `node_modules/tool/go.mod` or `svc/vendor/dep/go.mod` match
  the glob
- **THEN** no project is inferred for them

#### Scenario: unparseable go.work

- **WHEN** a `go.work` cannot be parsed
- **THEN** it claims no dirs and the project graph is still built

### Requirement: workspace membership

A module dir SHALL be a workspace member iff it appears in a `go.work`
`use` directive. `use` paths SHALL resolve against the go.work's own
directory; paths escaping the workspace SHALL be skipped and a `use` dir
without a `go.mod` SHALL be skipped. When several `go.work` files claim
the same dir, the first in depth-then-lexical order SHALL win. Member
projects SHALL be attributed to their `go.work` config file so work-file
edits re-infer them.

#### Scenario: member attribution

- **WHEN** `go.work` claims `svc`
- **THEN** the `svc` project is emitted in the `go.work` result and
  `svc/go.mod` emits no result of its own

#### Scenario: contested claim

- **GIVEN** `a/go.work` and `b/go.work` both `use` dir `svc`
- **THEN** `a/go.work` (earlier in sorted order) claims `svc` and
  `b/go.work` emits nothing

#### Scenario: use path outside the workspace

- **WHEN** `a/go.work` declares `use ../../outside`
- **THEN** that entry is skipped

### Requirement: module targets

Each module project SHALL get `build`, `test`, and `vet` targets running
`go build ./...`, `go test ./...`, and `go vet ./...` via
`nx:run-commands` with `cwd: '{projectRoot}'` and `cache: true`. Inputs
SHALL be `{projectRoot}/go.mod`, `{projectRoot}/go.sum`, and
`{projectRoot}/**/*.go`; workspace members SHALL additionally hash
`{workspaceRoot}/<go.work>` and the sibling `go.work.sum`. No module path,
credential, or flag SHALL be interpolated into argv.

#### Scenario: standalone module targets

- **WHEN** `svc/go.mod` is unclaimed
- **THEN** `svc` gets cached `build`/`test`/`vet` running `go <sub> ./...`
  with `cwd: '{projectRoot}'` and no `go.work` inputs

#### Scenario: member inputs

- **WHEN** `svc` is claimed by `tools/go.work`
- **THEN** its targets' inputs include `{workspaceRoot}/tools/go.work` and
  `{workspaceRoot}/tools/go.work.sum`

### Requirement: lint target

A `lint` target running `golangci-lint run ./...` (`cwd: '{projectRoot}'`,
`cache: true`) SHALL be inferred when `.golangci.yml`, `.golangci.yaml`,
or `.golangci.json` exists in the module dir, falling back to the
workspace root; the found config SHALL be a lint input. The `lint`
plugin option (default `true`) SHALL disable lint inference entirely when
`false`.

#### Scenario: module-local config

- **GIVEN** `svc/.golangci.yml` exists
- **THEN** project `svc` gains `lint` with `{workspaceRoot}/svc/.golangci.yml`
  as an input

#### Scenario: workspace-root fallback

- **GIVEN** only `.golangci.yml` at the workspace root
- **THEN** every module gains `lint` hashing the root config

#### Scenario: no config

- **WHEN** no `.golangci.{yml,yaml,json}` exists anywhere
- **THEN** no `lint` target is inferred

#### Scenario: lint disabled

- **WHEN** the plugin is registered with `{ "lint": false }`
- **THEN** no `lint` target is inferred even where a config exists

### Requirement: init generator

`@nx-devkit/go:init` SHALL register the plugin in `nx.json` without
duplicating an existing entry. The generator SHALL install no
dependencies — `go` and `golangci-lint` are toolchains, not npm packages.

#### Scenario: fresh workspace

- **WHEN** `nx g @nx-devkit/go:init` runs
- **THEN** `nx.json` `plugins` gains `@nx-devkit/go`

#### Scenario: rerun

- **WHEN** the generator runs twice
- **THEN** `nx.json` still contains exactly one `@nx-devkit/go` entry
