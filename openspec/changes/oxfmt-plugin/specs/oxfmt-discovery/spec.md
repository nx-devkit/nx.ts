# oxfmt-plugin spec delta: oxfmt-discovery

## ADDED Requirements

### Requirement: Oxfmt config discovery

The plugin SHALL watch oxfmt config files matching
`**/{.oxfmtrc.json,.oxfmtrc.jsonc,oxfmt.config.ts,oxfmt.config.mts}` via
`createNodesV2` — exactly the names oxfmt auto-discovers when walking up
from a formatted file. Other extensions load only via `oxfmt -c` and SHALL
NOT trigger inference; `package.json` carries no oxfmt key.

#### Scenario: Nested config

- **WHEN** `.oxfmtrc.json` exists under `packages/lib`
- **THEN** project `packages/lib` gains `format` and `format-check` targets
  with `cwd` set to the project root

#### Scenario: TypeScript config

- **WHEN** `oxfmt.config.ts` exists under `packages/lib`
- **THEN** project `packages/lib` gains `format` and `format-check` targets

#### Scenario: Configs inside node_modules or escaping the workspace

- **WHEN** a matched config sits under `node_modules` or outside the
  workspace root
- **THEN** no project or target is inferred for it

#### Scenario: Workspace-root config

- **WHEN** `.oxfmtrc.json` (or any oxfmt config) sits at the workspace root
- **THEN** the plugin infers nothing — root configs belong to the preset's
  fallback or `nx format`

#### Scenario: Several config forms in one directory

- **WHEN** a directory contains both `.oxfmtrc.json` and
  `.oxfmtrc.jsonc` (oxfmt allows only one config per directory)
- **THEN** exactly one project entry is emitted — the first glob hit wins

### Requirement: Format targets

The plugin SHALL infer `format` running `oxfmt --write .` with
`cache: false` (it mutates source files) and `format-check` running
`oxfmt --check .` with `cache: true`, both via `nx:run-commands`. Inputs
cover the matched config file plus all project files. Plugin options
`formatCommand` / `formatCheckCommand` override the command strings.

#### Scenario: Default invocation

- **WHEN** a project has `.oxfmtrc.json`
- **THEN** `format` runs `oxfmt --write .` uncached and `format-check` runs
  `oxfmt --check .` cached

#### Scenario: Command overrides

- **WHEN** `formatCommand`/`formatCheckCommand` options are provided
- **THEN** the targets run the given commands

### Requirement: Init generator

`nx g @nx-devkit/oxfmt:init` SHALL register `@nx-devkit/oxfmt` in `nx.json`
plugins (idempotent, comment/formatting preserving) and install the `oxfmt`
peer dependency as a devDependency when missing.

#### Scenario: Fresh registration

- **WHEN** `init` runs on a workspace without the plugin
- **THEN** `nx.json` gains an `@nx-devkit/oxfmt` plugin entry and
  `package.json` gains an `oxfmt` devDependency

#### Scenario: Rerun

- **WHEN** `init` runs twice
- **THEN** the plugin entry is not duplicated
