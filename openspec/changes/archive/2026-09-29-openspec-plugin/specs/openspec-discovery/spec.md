# Spec: openspec-discovery

## ADDED Requirements

### Requirement: openspec/config.yaml triggers spec-validate inference

The plugin MUST use `createNodesV2` with trigger glob `**/openspec/config.yaml`.
For each config found, the owning project (the directory containing
`openspec/`, including the workspace root) gets a cached `spec-validate` target
running `openspec validate --all --strict` via `nx:run-commands` with
`cwd` = `{projectRoot}` and inputs covering `openspec/**` under that root.

#### Scenario: Root config infers repo-wide target

- **WHEN** the workspace contains `openspec/config.yaml`
- **THEN** the root project has a `spec-validate` target running
  `openspec validate --all --strict` with inputs `{workspaceRoot}/openspec/**`

#### Scenario: Nested config infers project target

- **WHEN** `packages/foo/openspec/config.yaml` exists
- **THEN** the `packages/foo` project has `spec-validate` with inputs
  `{projectRoot}/openspec/**`

#### Scenario: node_modules config ignored

- **WHEN** `node_modules/pkg/openspec/config.yaml` exists
- **THEN** no target is inferred for it

### Requirement: Per-change atomized validate targets

The plugin MUST infer, for every subdirectory of `openspec/changes/` that
contains `proposal.md` (the `archive/` directory excluded), a
`spec-validate:<change-id>` target running `openspec validate '<id>' --strict`
with inputs scoped to `openspec/changes/<id>/**`, so editing one change does
not re-validate unrelated changes. `spec-validate:<id>` targets MUST be omitted
when the `perChange` option is `false`.

#### Scenario: change dir gets an atomized target

- **WHEN** `openspec/changes/alpha/proposal.md` exists
- **THEN** the owning project has `spec-validate:alpha` running
  `openspec validate 'alpha' --strict` with inputs
  `openspec/changes/alpha/**`

#### Scenario: dirs without proposal.md are not changes

- **WHEN** `openspec/changes/notes/` exists without `proposal.md`
- **THEN** no `spec-validate:notes` target is inferred

### Requirement: Options

The plugin MUST accept `targetName` (renames `spec-validate` and the per-change
prefix), `perChange` (default true), and `strict` (default true — appends
`--strict`).

#### Scenario: strict disabled

- **WHEN** option `strict` is `false`
- **THEN** targets run `openspec validate --all` and `openspec validate '<id>'`
  without `--strict`

### Requirement: init generator registers the plugin

`nx add @nx-devkit/openspec` MUST run an `init` generator that registers the
plugin in `nx.json` via the shared `registerPlugin` helper, preserving JSONC
comments and formatting, deduplicating existing registrations, and accepting an
optional `pluginPath` override.

#### Scenario: registered plugin in nx.json

- **WHEN** a consumer runs `nx add @nx-devkit/openspec`
- **THEN** `nx.json` gains `"@nx-devkit/openspec"` under `plugins` exactly once
