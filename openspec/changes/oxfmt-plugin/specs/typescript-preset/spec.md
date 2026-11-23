# oxfmt-plugin spec delta: typescript-preset

## ADDED Requirements

### Requirement: Oxfmt format targets

When `oxfmt: true` (default) and a project has an oxfmt config
(`.oxfmtrc.json`, `.oxfmtrc.jsonc`, `oxfmt.config.ts`, `oxfmt.config.mts`),
the plugin MUST infer `format` (`oxfmt --write .`, cache: false) and
`format-check` (`oxfmt --check .`, cache: true) targets. A workspace-root
oxfmt config applies to every project lacking its own (matching the
lint/format root-fallback pattern) and is added to the format targets'
inputs. Oxfmt takes precedence over biome for `format`/`format-check`.

#### Scenario: Oxfmt format targets inferred

- **WHEN** a project has `tsconfig.json` and `.oxfmtrc.json`
- **THEN** the plugin infers `format` (cache: false) and `format-check`
  (cache: true) running `oxfmt --write .` / `oxfmt --check .`

#### Scenario: Oxfmt wins over biome

- **WHEN** a project has both `.oxfmtrc.json` and `biome.json`
- **THEN** `format`/`format-check` run oxfmt; biome may still provide its
  `lint` fallback

#### Scenario: Oxfmt disabled

- **WHEN** `oxfmt: false` is set and a project has `.oxfmtrc.json` (and
  `biome.json`)
- **THEN** no oxfmt targets are inferred (biome owns `format` as before)

#### Scenario: Workspace-root fallback

- **WHEN** only `.oxfmtrc.json` at the workspace root exists and a project
  has `tsconfig.json`
- **THEN** the project gets `format`/`format-check` targets whose inputs
  include the workspace-root oxfmt config

## MODIFIED Requirements

### Requirement: Biome format and lint targets

When `biome: true` (default) and a project has `biome.json` or
`biome.jsonc`, the plugin MUST infer `format` and `format-check` targets
using `npx biome` — unless an enabled oxfmt config already provides the
format family (oxfmt wins). A `lint` target via biome is inferred only
when neither enabled oxlint nor enabled eslint provides `lint`.

#### Scenario: Biome format targets inferred

- **WHEN** a project has `tsconfig.json` and `biome.json` (no `.oxlintrc.*`,
  no oxfmt config)
- **THEN** the plugin infers `format` (cache: false), `format-check`
  (cache: true), and `lint` (cache: true) targets

#### Scenario: Biome format under oxfmt

- **WHEN** a project has both `biome.json` and `.oxfmtrc.json`
- **THEN** `format`/`format-check` run oxfmt, not biome

#### Scenario: Biome with oxlint — no biome lint

- **WHEN** a project has both `biome.json` and `.oxlintrc.json` (oxlint enabled)
- **THEN** the plugin infers `format` and `format-check` from biome (or oxfmt
  when an oxfmt config is present), and `lint` from oxlint (no biome `lint`
  target)

#### Scenario: Oxlint disabled, biome provides lint

- **WHEN** `oxlint: false` is set, no `eslint.config.*` is present, and a project has both `biome.json` and `.oxlintrc.json`
- **THEN** the plugin infers `format` and `format-check` from biome (or oxfmt
  when an oxfmt config is present), and `lint` from biome (no oxlint `lint`
  target)

#### Scenario: ESLint wins over biome for lint

- **WHEN** `eslint: true`, a project has `eslint.config.*` and `biome.json`, and oxlint is not providing `lint`
- **THEN** the plugin infers `format` and `format-check` from biome (or oxfmt
  when an oxfmt config is present), and `lint` from eslint (no biome `lint`
  target)
