# turbo-inference

## ADDED Requirements

### Requirement: turbo.json discovery

The plugin SHALL watch `**/turbo.json` via `createNodesV2`. A config at
the workspace root applies to every workspace package; a config nested in
a package directory applies to that package only and overrides the
root-inferred task of the same name. A config that cannot be parsed MUST
NOT break the project graph — the plugin SHALL warn and skip it.

#### Scenario: root turbo.json

- **WHEN** `turbo.json` exists at the workspace root
- **THEN** its `tasks` apply to every workspace package carrying a
  matching `scripts` entry

#### Scenario: package-level turbo.json

- **GIVEN** `packages/app/turbo.json` with `extends: ["//"]`
- **WHEN** it defines task `deploy`
- **THEN** project `packages/app` gains a `deploy` target — no other
  project does

#### Scenario: unparseable config

- **WHEN** a `turbo.json` cannot be parsed
- **THEN** no targets are inferred for it and the project graph is still
  built

### Requirement: v1 and v2 schema support

The plugin SHALL read task definitions from `tasks` (turbo v2) and
`pipeline` (turbo v1). When both keys are present, `tasks` wins.

#### Scenario: v2 tasks key

- **WHEN** `turbo.json` contains a `tasks` object
- **THEN** each key becomes a target name

#### Scenario: v1 pipeline key

- **WHEN** `turbo.json` contains only a `pipeline` object
- **THEN** each key becomes a target name

### Requirement: script-gated inference

A task SHALL only produce a target on a package whose `package.json`
declares a `scripts` entry of the same name — the exact rule turbo itself
applies. Packages without the script get no target.

#### Scenario: package with matching script

- **GIVEN** root `turbo.json` defines `build`
- **WHEN** `packages/app/package.json` has `scripts.build`
- **THEN** project `packages/app` gains `build` via `nx:run-script` with
  `options.script = "build"`

#### Scenario: package without matching script

- **GIVEN** root `turbo.json` defines `build`
- **WHEN** `packages/docs/package.json` has no `scripts.build`
- **THEN** `packages/docs` gains no `build` target

### Requirement: dependsOn mapping

`dependsOn` entries SHALL map to Nx `TargetDependencyConfig`:

- `^task` → `{ target: "task", dependencies: true }`
- `task` → `{ target: "task" }` (same project)
- `pkg#task` → `{ target: "task", projects: ["pkg"] }`
- `//#task` → `{ target: "task", projects: ["<root project name>"] }`

The legacy `projects: "self" | "dependencies"` strings SHALL NOT be
emitted — Nx 24 rejects them.

#### Scenario: caret dependency

- **WHEN** task `build` declares `dependsOn: ["^build"]`
- **THEN** the inferred `build` target depends on `build` of each
  dependency project

#### Scenario: root task dependency

- **WHEN** task `deploy` declares `dependsOn: ["//#gen"]`
- **THEN** the inferred target depends on `gen` of the root project

### Requirement: task keys with selectors

`//#task` keys SHALL produce targets on the root project (only when the
root `package.json` has the matching script and a `name`).
`<package>#<task>` keys SHALL produce targets only on the named package.

#### Scenario: root task

- **WHEN** root `turbo.json` defines `//#format` and the root
  `package.json` has `scripts.format`
- **THEN** the root project gains a `format` target

#### Scenario: per-package override

- **WHEN** root `turbo.json` defines `docs#lint` and package `docs` has
  `scripts.lint`
- **THEN** only project `docs` gains that `lint` target shape

### Requirement: inputs and outputs

Each `inputs` entry SHALL map to `{projectRoot}/<glob>`; the literal
`$TURBO_DEFAULT$` SHALL map to the `default` named input, and `!`
negations SHALL be preserved. When `inputs` is absent the target SHALL
use `default`. Each `outputs` entry SHALL map the same way; when absent
the target SHALL default to `{projectRoot}/dist/**` and
`{projectRoot}/build/**` (turbo's own defaults). The originating
`turbo.json` SHALL always appear as a `{workspaceRoot}/...` input so
config edits re-hash tasks.

#### Scenario: explicit inputs

- **WHEN** task `build` declares `inputs: ["src/**", "$TURBO_DEFAULT$", "!src/gen/**"]`
- **THEN** the target's inputs contain `{projectRoot}/src/**`,
  `default`, and `!{projectRoot}/src/gen/**`

#### Scenario: default outputs

- **WHEN** task `build` declares no `outputs`
- **THEN** the target's outputs are `{projectRoot}/dist/**` and
  `{projectRoot}/build/**`

### Requirement: env hashing and cache

`env` and `passThroughEnv` entries SHALL become `{ env: "VAR" }` inputs;
`dotEnv` SHALL become `{projectRoot}/<file>` inputs. `cache: false`
SHALL produce `cache: false`; otherwise targets are `cache: true`.
`persistent: true` SHALL produce `continuous: true` and `cache: false`.
`globalDependencies`, `globalDotEnv`, `globalEnv` and
`globalPassThroughEnv` SHALL fold into every inferred target's inputs —
`CreateNodesResult` cannot emit `targetDefaults`/`namedInputs` in Nx 24.

#### Scenario: env hashing

- **WHEN** task `deploy` declares `env: ["DEPLOY_TOKEN"]` and
  `passThroughEnv: ["CI"]`
- **THEN** the target's inputs contain `{ env: "DEPLOY_TOKEN" }` and
  `{ env: "CI" }`

#### Scenario: uncached task

- **WHEN** task `test` declares `cache: false`
- **THEN** the `test` target is `cache: false`

#### Scenario: persistent dev server

- **WHEN** task `dev` declares `persistent: true`
- **THEN** the `dev` target is `continuous: true` and `cache: false`

### Requirement: workspace package discovery

The plugin SHALL discover workspace packages from, in precedence order:
`workspaces` in the root `package.json` (array or `{ packages }` form),
`packages:` in `pnpm-workspace.yaml`, `packages` in `lerna.json`, falling
back to `packages/*` and `apps/*`. Glob patterns SHALL support `*`,
partial-segment wildcards, `**`, and `!` negations; `node_modules` and
hidden directories SHALL be skipped.

#### Scenario: npm workspaces

- **WHEN** root `package.json` declares `workspaces: ["packages/*"]`
- **THEN** every `packages/*/package.json` dir is a workspace package

#### Scenario: pnpm workspace

- **WHEN** `pnpm-workspace.yaml` lists `packages: ["apps/*", "packages/**"]`
- **THEN** matching dirs are workspace packages

### Requirement: init generator

`@nx-devkit/turbo:init` SHALL register the plugin in `nx.json` without
duplicating an existing entry. The plugin installs no runtime peer
dependency — it reads `turbo.json` and never shells out to `turbo`.

#### Scenario: fresh workspace

- **WHEN** `nx g @nx-devkit/turbo:init` runs
- **THEN** `nx.json` `plugins` gains `@nx-devkit/turbo`

#### Scenario: rerun

- **WHEN** the generator runs twice
- **THEN** `nx.json` still contains exactly one `@nx-devkit/turbo` entry
