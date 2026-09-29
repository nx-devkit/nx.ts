# commitlint-discovery

## ADDED Requirements

### Requirement: Commitlint config discovery

The plugin SHALL watch commitlint config files matching the glob `**/{commitlint.config.{js,ts,mjs,cjs,cts},.commitlintrc,.commitlintrc.{json,yaml,yml,js,ts,mjs,cjs,cts},package.json}` via `createNodesV2`.

#### Scenario: Standalone config at workspace root

- **WHEN** `commitlint.config.js` exists at the workspace root
- **THEN** the root project gains a `commitlint` target

#### Scenario: package.json carrying a commitlint key

- **WHEN** a `package.json` contains a top-level `commitlint` key
- **THEN** its owning project gains a `commitlint` target

#### Scenario: package.json without a commitlint key

- **WHEN** a `package.json` lacks a `commitlint` key and no other config file exists in its directory
- **THEN** no target is inferred

#### Scenario: Nested config

- **WHEN** `.commitlintrc.json` exists under `packages/lib`
- **THEN** project `packages/lib` gains a `commitlint` target with `cwd` set to `{projectRoot}`

### Requirement: Deterministic config precedence

When several config forms coexist in one directory, the plugin SHALL pick the single winner following cosmiconfig's `commitlint` search order (`package.json` key → `.commitlintrc*` → `commitlint.config.*`).

#### Scenario: Multiple configs in one directory

- **WHEN** a directory contains both `commitlint.config.js` and a `package.json` with a `commitlint` key
- **THEN** exactly one `commitlint` target is inferred and all config files are recorded as target inputs

### Requirement: Uncached git-dependent target

The inferred `commitlint` target SHALL run `npx commitlint <args>` (`args` default `--last`) via `nx:run-commands` with `cache: false`, since the verdict depends on git history rather than file contents.

#### Scenario: Default invocation

- **WHEN** the target runs with default options
- **THEN** the command is `npx commitlint --last` executed in the owning project root

#### Scenario: Custom args

- **WHEN** plugin options set `args` to `--edit .git/COMMIT_EDITMSG`
- **THEN** the command is `npx commitlint --edit .git/COMMIT_EDITMSG`

### Requirement: Path safety

The plugin SHALL skip directories inside `node_modules` or escaping the workspace root.

#### Scenario: Config under node_modules

- **WHEN** a config file resolves under `node_modules/**` or outside the workspace
- **THEN** no target is inferred for it
