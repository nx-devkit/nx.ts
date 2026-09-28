# Spec: markdownlint-discovery

## ADDED Requirements

### Requirement: Config file triggers lint-md target inference

The plugin MUST use `createNodesV2` with trigger glob
`**/.markdownlint*.{json,jsonc,yaml,yml,cjs,mjs}`. For each config file found,
the owning project (the directory containing the file, including the workspace
root) gets a `lint-md` target that runs `markdownlint-cli2` via `nx:run-commands`
with `cwd` at the config's own directory (`{projectRoot}`), `cache: true`, and
inputs covering the Markdown glob, every `.markdownlint*` config and every
`.gitignore` under the linted tree (cli2 applies nested per-directory configs
and `gitignore: true` reads ignore files). Inputs MUST be valid Nx filesets
(prefixed with `{workspaceRoot}` or `{projectRoot}`). By default the command
carries the `'#**/node_modules/**'` negation glob; the `ignoreGlobs` option
MAY replace that default list. Config basenames are classified per the cli2
documentation: `.markdownlint-cli2.{jsonc,yaml,cjs,mjs}` are runner configs and
`.markdownlint.{jsonc,json,yaml,yml,cjs,mjs}` are rules configs; any other
matched name is neither auto-discovered nor a valid `--config` target, so a
directory containing only such names MUST NOT infer a target.

#### Scenario: Root config infers repo-wide target

- **WHEN** the workspace root contains `.markdownlint.json`
- **THEN** the root project has a `lint-md` target running
  `markdownlint-cli2 '**/*.md' '#**/node_modules/**' --config '.markdownlint.json'`
  with inputs `{workspaceRoot}/**/*.md` and `{workspaceRoot}/.markdownlint.json`

#### Scenario: Nested config infers project target

- **WHEN** `packages/foo/.markdownlint.json` exists
- **THEN** the `packages/foo` project has a `lint-md` target running
  `markdownlint-cli2 '**/*.md' '#**/node_modules/**' --config '.markdownlint.json'`
  run with `cwd` = `{projectRoot}`

#### Scenario: node_modules config ignored

- **WHEN** `node_modules/pkg/.markdownlint.json` exists
- **THEN** no target is inferred for it

### Requirement: cli2 and rules config families are distinguished

The plugin MUST NOT pass `.markdownlint-cli2.*` files to `--config` — they are
markdownlint-cli2 runner options (globs, gitignore, frontMatter) auto-discovered
by the CLI. Only `.markdownlint.*` rules configs go to `--config`, selected by
the documented cli2 precedence (`jsonc > json > yaml > yml > cjs > mjs`). When
both coexist in one directory, a single `lint-md`/`<targetName>:fix` pair is
inferred.

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

#### Scenario: fix target name derives from targetName

- **WHEN** the plugin option `targetName` is `"md-lint"` and `fixTargetName` is
  not set
- **THEN** the inferred targets are `md-lint` and `md-lint:fix`

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
