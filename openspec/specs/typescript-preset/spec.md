# typescript-preset Specification

## Purpose

TBD - created by archiving change config-free-tsdown-build. Update Purpose after archive.

## Requirements

### Requirement: Config-free tsdown build inference

When `tsdown: true` (default) and a project has NO `tsdown.config.*` but has `src/index.ts` AND a `package.json` with a publishable signal (`exports` field, `bin` field, or `main` + `files`), the plugin MUST infer the same `build` and `build:watch` targets it infers for `tsdown.config.*`.

#### Scenario: Publishable package with exports gets build targets

- **WHEN** a project has `tsconfig.json`, `src/index.ts`, and `package.json` with an `exports` field but no `tsdown.config.*`
- **THEN** the plugin infers `build` (executor `@nx-devkit/typescript:build`, outputs `{projectRoot}/dist`, `dependsOn: ['^build']`) and `build:watch` targets

#### Scenario: Publishable package with main + files gets build targets

- **WHEN** a project has `tsconfig.json`, `src/index.ts`, and `package.json` with both `main` and `files` fields but no `tsdown.config.*`
- **THEN** the plugin infers `build` and `build:watch` targets

#### Scenario: Publishable package with bin gets build targets

- **WHEN** a project has `tsconfig.json`, `src/index.ts`, and `package.json` with a `bin` field but no `tsdown.config.*`
- **THEN** the plugin infers `build` and `build:watch` targets

#### Scenario: Bare src/index.ts is not enough

- **WHEN** a project has `tsconfig.json` and `src/index.ts` but `package.json` has no `exports`, `bin`, or `main` + `files` and no `tsdown.config.*`
- **THEN** the plugin does NOT infer `build`/`build:watch`

#### Scenario: Publishable package without conventional entry gets no build

- **WHEN** a project has `tsconfig.json` and `package.json` with `exports` but no `src/index.ts` and no `tsdown.config.*`
- **THEN** the plugin does NOT infer `build`/`build:watch` (tsdown would fail with "No input files")

#### Scenario: Explicit config still wins

- **WHEN** a project has `tsdown.config.ts` and also satisfies the publishable-package heuristic
- **THEN** the plugin infers `build`/`build:watch` from the config path as before (same targets, no behavioral change)

#### Scenario: tsdown option disables config-free inference

- **WHEN** `tsdown: false` is set and a project satisfies the publishable-package heuristic
- **THEN** the plugin does NOT infer `build`/`build:watch`

### Requirement: Build executor accepts config-free projects

The `@nx-devkit/typescript:build` executor MUST run tsdown when the project has no `tsdown.config.*` but has the conventional `src/index.ts` entry (tsdown's own fallback). It MUST still fail when neither exists.

#### Scenario: Config-free project builds via executor

- **WHEN** a project has `src/index.ts` but no `tsdown.config.*`
- **THEN** the executor invokes tsdown (which resolves `src/index.ts` as its default entry) instead of returning `{ success: false }`

#### Scenario: No config and no entry still fails

- **WHEN** a project has neither `tsdown.config.*` nor `src/index.ts`
- **THEN** the executor returns `{ success: false }` with an error naming both missing inputs

### Requirement: Native Node test runner inference

When a project has `tsconfig.json` and test files (`*.test.ts` or `*.spec.ts` in `src/` or `test/`) but NO `vitest.config.*`, the plugin MUST infer a `test` target using `node --test`.

#### Scenario: Native test target inferred

- **WHEN** a project has `tsconfig.json` and `src/foo.test.ts` but no `vitest.config.*`
- **THEN** the plugin infers a `test` target with command `node --test --test-reporter spec`

#### Scenario: Vitest takes priority over native

- **WHEN** a project has both `vitest.config.ts` and `src/foo.test.ts`
- **THEN** the plugin infers vitest targets (`test`, `test:watch`, `test:coverage`) and does NOT infer native node targets

#### Scenario: No test files means no test targets

- **WHEN** a project has `tsconfig.json` but no test files and no vitest config
- **THEN** the plugin infers no test targets

### Requirement: TAP reporter option

When `tap: true` option is set and native test targets are inferred, the plugin MUST infer a `test:tap` target using `node --test --test-reporter tap`.

#### Scenario: TAP target inferred

- **WHEN** `tap: true` is set and project has test files but no vitest config
- **THEN** the plugin infers both `test` (spec reporter) and `test:tap` (tap reporter) targets

### Requirement: Coverage option

When `coverage: true` option is set and native test targets are inferred, the plugin MUST infer a `test:coverage` target using `node --test --experimental-test-coverage`.

#### Scenario: Coverage target inferred

- **WHEN** `coverage: true` is set and project has test files but no vitest config
- **THEN** the plugin infers a `test:coverage` target

### Requirement: Oxlint target delegation

When `oxlint: true` (default) and a project has `.oxlintrc.*`, the plugin MUST infer a `lint` target using `npx oxlint .`. Oxlint takes precedence over biome for the `lint` target. When `oxlint: false`, the oxlint `lint` target is NOT inferred even if `.oxlintrc.*` exists.

#### Scenario: Oxlint target inferred

- **WHEN** a project has `tsconfig.json` and `.oxlintrc.json`
- **THEN** the plugin infers a `lint` target with command `npx oxlint .`

#### Scenario: Oxlint disabled — no oxlint lint

- **WHEN** `oxlint: false` is set and a project has `.oxlintrc.json`
- **THEN** the plugin does NOT infer an oxlint `lint` target

### Requirement: Biome format and lint targets

When `biome: true` (default) and a project has `biome.json` or `biome.jsonc`, the plugin MUST infer `format` and `format-check` targets using `npx biome`. A `lint` target via biome is inferred ONLY when oxlint is effectively disabled (`oxlint: false`) or no `.oxlintrc.*` is present — i.e. biome provides `lint` when oxlint is not providing it.

#### Scenario: Biome format targets inferred

- **WHEN** a project has `tsconfig.json` and `biome.json` (no `.oxlintrc.*`)
- **THEN** the plugin infers `format` (cache: false), `format-check` (cache: true), and `lint` (cache: true) targets

#### Scenario: Biome with oxlint — no biome lint

- **WHEN** a project has both `biome.json` and `.oxlintrc.json` (oxlint enabled)
- **THEN** the plugin infers `format` and `format-check` from biome, and `lint` from oxlint (no biome `lint` target)

#### Scenario: Oxlint disabled, biome provides lint

- **WHEN** `oxlint: false` is set and a project has both `biome.json` and `.oxlintrc.json`
- **THEN** the plugin infers `format` and `format-check` from biome, and `lint` from biome (no oxlint `lint` target)

### Requirement: Tsdown build target

When `tsdown: true` (default) and a project has `tsdown.config.ts`, the plugin MUST infer a `build` target using `npx tsdown`.

#### Scenario: Build target inferred

- **WHEN** a project has `tsconfig.json` and `tsdown.config.ts`
- **THEN** the plugin infers a `build` target with command `npx tsdown`, outputs `{projectRoot}/dist`, and `dependsOn: ['^build']`

### Requirement: Combined mega-preset target inference

The plugin MUST infer `typecheck` from `tsconfig.json`. Test target inference MUST support BOTH vitest (when `vitest.config.*` exists) AND the native Node test runner (when test files exist without vitest config).

#### Scenario: All targets from one plugin

- **WHEN** a project has `tsconfig.json`, `tsdown.config.ts`, `.oxlintrc.json`, `biome.json`, and `src/foo.test.ts`
- **THEN** the plugin infers `typecheck`, `build`, `lint`, `format`, `format-check`, and `test` targets — all from `@nx-devkit/typescript` alone
