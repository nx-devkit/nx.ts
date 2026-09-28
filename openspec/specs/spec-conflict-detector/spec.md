# spec-conflict-detector Specification

## Purpose
Defines the `spec-check` script that statically scans plugin sources and
canonical specs for duplicate target/inference definitions, so two plugins
cannot silently claim the same target name.
## Requirements
### Requirement: Detector scans openspec specs + plugin sources
The script `scripts/spec-check.ts` MUST scan every `.ts` and `.md` file under `openspec/specs/` and `packages/*/src/plugin.ts` for target/inference definitions (`openspec/changes/` is excluded — deltas there may intentionally overlap with canonical specs).

#### Scenario: Scan coverage
- **WHEN** a new file is added under `openspec/specs/`
- **THEN** the next `bun run spec:check` invocation includes it in the scan

### Requirement: Detector exits non-zero on duplicate target keys
The detector MUST exit with code `1` (and print a human-readable conflict report) when the same target key (`build`, `test`, `lint`, `format`, `format-check`, `typecheck`, `test:watch`, `test:coverage`) is defined in more than one file.

#### Scenario: Duplicate target key across files
- **WHEN** two different files each declare the same target key (e.g. `'lint'`) adjacent to a recognized inference pattern (`createNodesV2`, `infer*Target*`, `*Target:` declarations)
- **THEN** `bun run spec:check` exits 1 and reports both files with line numbers

#### Scenario: Single-file definition is OK
- **WHEN** exactly one file defines a given target key
- **THEN** `bun run spec:check` exits 0

### Requirement: Detector is executable via bun
The detector MUST run with `bun run spec:check` (i.e. `bun run scripts/spec-check.ts`).

#### Scenario: Detector runs on bun
- **WHEN** a developer types `bun run spec:check`
- **THEN** the script executes under bun and reports OK or conflicts within a few hundred milliseconds

