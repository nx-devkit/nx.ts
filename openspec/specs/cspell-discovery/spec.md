# cspell-discovery Specification

## Purpose

Infers a `spell` Nx target on the project owning a cspell config — spell-checking without project.json.

## Requirements

### Requirement: Cspell config discovery

The plugin SHALL watch cspell config files matching `**/{cspell.json,cspell.config.{js,cjs,mjs,ts,json},.cspell.json,cspell.{yaml,yml},.cspell.{yaml,yml},package.json}` via `createNodesV2`.

#### Scenario: Standalone config at workspace root

- **WHEN** `cspell.json` exists at the workspace root
- **THEN** the root project gains a `spell` target

#### Scenario: package.json carrying a cspell key

- **WHEN** a `package.json` contains a top-level `cspell` key
- **THEN** its owning project gains a `spell` target

#### Scenario: package.json without a cspell key

- **WHEN** a `package.json` lacks a `cspell` key and no other config file exists in its directory
- **THEN** no target is inferred

#### Scenario: Nested config

- **WHEN** `cspell.json` exists under `packages/lib`
- **THEN** project `packages/lib` gains a `spell` target with `cwd` set to `{projectRoot}`

### Requirement: Deterministic config precedence

When several config forms coexist in one directory, the plugin SHALL pick the single winner following cspell's documented search order (`package.json` key → `cspell.json` → `cspell.config.*` → yaml forms).

#### Scenario: Multiple configs in one directory

- **WHEN** a directory contains both `cspell.json` and a `package.json` with a `cspell` key
- **THEN** exactly one `spell` target is inferred and all config files are recorded as target inputs

### Requirement: Cached file-content target

The inferred `spell` target SHALL run `npx cspell lint <args>` (`args` default `.`) via `nx:run-commands` with `cache: true`, with inputs covering all project files plus every cspell config file in the directory.

#### Scenario: Default invocation

- **WHEN** the target runs with default options
- **THEN** the command is `npx cspell lint .` executed in the owning project root

#### Scenario: Custom args

- **WHEN** plugin options set `args` to `src/**/*.md`
- **THEN** the command is `npx cspell lint src/**/*.md`

### Requirement: Path safety

The plugin SHALL skip directories inside `node_modules` or escaping the workspace root.

#### Scenario: Config under node_modules

- **WHEN** a config file resolves under `node_modules/**` or outside the workspace
- **THEN** no target is inferred for it
