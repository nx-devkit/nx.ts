# Spec: markdownlint-discovery

## ADDED Requirements

### Requirement: Config file triggers lint-md target inference

The plugin MUST use `createNodesV2` with trigger glob
`**/.markdownlint*.{json,jsonc,yaml,yml,cjs,mjs}`. For each config file found,
the owning project (the directory containing the file, including the workspace
root) gets a `lint-md` target that runs `markdownlint-cli2` via `nx:run-commands`
with `cwd` at the workspace root, `cache: true`, and inputs covering the
Markdown glob plus the config file. Inputs MUST be valid Nx filesets (prefixed
with `{workspaceRoot}` or `{projectRoot}`). The command MUST always carry the
`'#**/node_modules/**'` negation glob so vendored dependencies are never linted.

#### Scenario: Root config infers repo-wide target

- **WHEN** the workspace root contains `.markdownlint.json`
- **THEN** the root project has a `lint-md` target running
  `markdownlint-cli2 '**/*.md' '#**/node_modules/**' --config .markdownlint.json`
  with inputs `{workspaceRoot}/**/*.md` and `{workspaceRoot}/.markdownlint.json`

#### Scenario: Nested config infers project target

- **WHEN** `packages/foo/.markdownlint.json` exists
- **THEN** the `packages/foo` project has a `lint-md` target running
  `markdownlint-cli2 '{projectRoot}/**/*.md' '#**/node_modules/**' --config packages/foo/.markdownlint.json`

#### Scenario: node_modules config ignored

- **WHEN** `node_modules/pkg/.markdownlint.json` exists
- **THEN** no target is inferred for it

### Requirement: cli2 and rules config families are distinguished

The plugin MUST NOT pass `.markdownlint-cli2.*` files to `--config` — they are
markdownlint-cli2 runner options (globs, gitignore, frontMatter) auto-discovered
by the CLI. Only `.markdownlint.*` rules configs go to `--config`. When both
coexist in one directory, a single `lint-md`/`lint-md:fix` pair is inferred.

#### Scenario: cli2 config alone infers target without --config

- **WHEN** `docs/.markdownlint-cli2.cjs` exists and no `.markdownlint.*` rules
  config is present in `docs/`
- **THEN** the `docs` project has `lint-md` whose command contains no
  `--config` flag

#### Scenario: Both configs merge into one target pair

- **WHEN** a directory contains both `.markdownlint.json` and
  `.markdownlint-cli2.jsonc`
- **THEN** exactly one `lint-md` target is inferred and its command includes
  `--config` pointing at the rules config

### Requirement: Optional fix target

The plugin MUST infer `lint-md:fix` (same command plus `--fix`, `cache: false`)
unless disabled via the `fixTargetName` option set to `false`.

#### Scenario: fix target disabled

- **WHEN** the plugin option `fixTargetName` is `false` and a config file exists
- **THEN** only `lint-md` is inferred, with no `lint-md:fix`

### Requirement: Custom target names and ignore globs

The plugin MUST accept `targetName` to rename `lint-md` and `ignoreGlobs` to
replace the default `['**/node_modules/**']` exclusion list emitted as
`#`-negation globs.

#### Scenario: renamed target

- **WHEN** option `targetName` is `"md-lint"`
- **THEN** the inferred targets are `md-lint` and `md-lint:fix`

### Requirement: init generator registers the plugin

`nx add @nx-devkit/markdownlint` MUST run an `init` generator that registers the
plugin in `nx.json` via the shared `registerPlugin` helper, preserving JSONC
comments and formatting, deduplicating existing registrations, and accepting an
optional `pluginPath` override.

#### Scenario: registered plugin in nx.json

- **WHEN** a consumer runs `nx add @nx-devkit/markdownlint`
- **THEN** `nx.json` gains `"@nx-devkit/markdownlint"` under `plugins` exactly
  once, and a JSONC `nx.json` keeps its comments intact
