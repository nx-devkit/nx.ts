# Spec: spec-conflict-detector

## ADDED Requirements

### Requirement: Detector scans openspec + plugin sources
The script `scripts/spec-check.ts` MUST scan every `.ts` and `.md` file under `openspec/` and `packages/*/src/plugin.ts` for target/inference definitions.

#### Scenario: Scan coverage
- **WHEN** a new file is added under `openspec/specs/`
- **THEN** the next `bun run spec:check` invocation includes it in the scan

### Requirement: Detector exits non-zero on duplicate target keys
The detector MUST exit with code `1` (and print a human-readable conflict report) when the same target key (`build`, `test`, `lint`, `format`, `format-check`, `typecheck`, `test:watch`, `test:coverage`) is defined in more than one file.

#### Scenario: Two plugins both define `lint`
- **WHEN** `@nx-devkit/oxlint` and `@nx-devkit/biome` both define a `lint` target in their respective `plugin.ts` files
- **THEN** `bun run spec:check` exits 1 and reports both files with line numbers

#### Scenario: Single-file definition is OK
- **WHEN** exactly one file defines a given target key
- **THEN** `bun run spec:check` exits 0

### Requirement: Detector is executable via bun
The detector MUST run with `bun run spec:check` (i.e. `bun run scripts/spec-check.ts`).

#### Scenario: Detector runs on bun
- **WHEN** a developer types `bun run spec:check`
- **THEN** the script executes under bun and reports OK or conflicts within a few hundred milliseconds
