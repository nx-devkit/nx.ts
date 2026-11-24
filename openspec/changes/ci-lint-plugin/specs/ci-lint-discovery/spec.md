# ci-lint-discovery

## ADDED Requirements

### Requirement: Workflow file discovery

The plugin SHALL watch workflow files matching `.github/workflows/*.{yml,yaml}` via `createNodesV2` and infer a single target on the root project (`.`).

#### Scenario: Workflows at the workspace root

- **WHEN** `.github/workflows/ci.yml` exists at the workspace root
- **THEN** the root project gains a `lint-ci` target

#### Scenario: Nested workflow directories ignored

- **WHEN** a file like `packages/foo/.github/workflows/ci.yml` exists under a package
- **THEN** no target is inferred for it (workflow files are repo-wide; only the root directory counts)

#### Scenario: No workflows

- **WHEN** no `.github/workflows/*.{yml,yaml}` file exists
- **THEN** no target is inferred

### Requirement: Optional tool execution

The inferred `lint-ci` target SHALL run each enabled tool through an `nx:run-commands` command generated for the platform shell (POSIX `command -v` / cmd.exe `where` probe): an installed tool runs and its real findings fail the target; a missing tool echoes a skip line and the target still succeeds. Every enabled leg runs even when an earlier leg fails — a failing leg records the failure and the command exits non-zero at the end.

#### Scenario: Both tools installed

- **WHEN** `actionlint` and `zizmor` are on PATH and a workflow has a violation
- **THEN** `nx run <root>:lint-ci` fails

#### Scenario: Tool missing

- **WHEN** `zizmor` is not on PATH
- **THEN** the zizmor leg echoes `ci-lint: zizmor not found on PATH — skipping` and does not fail the target; no `zizmorOutput` file is written. A `zizmorOutput` file left over from an earlier run is left untouched, so a later SARIF upload step may still pick up the stale file

#### Scenario: Earlier leg fails

- **WHEN** `actionlint` reports a violation and `zizmor` is installed
- **THEN** the zizmor leg still runs (including any `zizmorOutput` redirect) and the target fails

#### Scenario: Tool disabled

- **WHEN** the plugin is configured with `actionlint: false`
- **THEN** the generated command contains no actionlint leg

#### Scenario: Both tools disabled

- **WHEN** the plugin is configured with `actionlint: false` and `zizmor: false`
- **THEN** no target is inferred

### Requirement: Cached file-content target

The inferred `lint-ci` target SHALL be `cache: true` with inputs covering `{workspaceRoot}/.github/workflows/*.{yml,yaml}` plus `.github/actionlint.{yml,yaml}`, `.github/zizmor.{yml,yaml}`, and `zizmor.{yml,yaml}` config files, so config edits bust the cache. Each enabled tool SHALL also contribute a runtime input hashing its `--version` output, so installing or upgrading a tool on PATH busts the cache instead of replaying a stale skip or result.

#### Scenario: Config edit busts the cache

- **WHEN** `.github/actionlint.yaml` is added or changed after a successful run
- **THEN** the next `lint-ci` run is a cache miss and re-executes the command

#### Scenario: Tool installed after a cached skip

- **WHEN** a run succeeded by skipping a missing tool and the tool is installed or upgraded afterwards
- **THEN** the next `lint-ci` run is a cache miss and the tool actually executes

### Requirement: SARIF-friendly zizmor output

The plugin SHALL support `zizmorFormat` (`plain` default, `json`, `sarif`) and `zizmorOutput` options so zizmor output can be redirected to a `.sarif` file for GitHub code-scanning upload.

#### Scenario: SARIF output configured

- **WHEN** options set `zizmorFormat: "sarif"` and `zizmorOutput: "zizmor.sarif"`
- **THEN** the command contains `zizmor --format sarif '<dir>' > 'zizmor.sarif'`
