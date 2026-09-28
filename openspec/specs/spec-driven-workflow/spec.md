# spec-driven-workflow Specification

## Purpose

Defines how this repository uses OpenSpec: the initialized config, the
canonical `openspec/specs/SPEC.md` architecture index, the required
change-folder layout, and traceability between `tasks.md` and convoy beads.

## Requirements

### Requirement: OpenSpec initialized with kilocode tool

The repository MUST be initialized with OpenSpec using the `kilocode` tool flag so that the agent receives the matching slash-command set.

#### Scenario: openspec config exists

- **WHEN** a developer inspects `openspec/config.yaml`
- **THEN** it declares `schema: spec-driven` (the kilocode tool selection is reflected by the generated slash-command files, not stored in config.yaml)

### Requirement: SPEC.md captures full architecture

The file `openspec/specs/SPEC.md` MUST describe purpose, architecture (4 tool plugins + 1 preset), file-trigger to target inference matrix, demo workspace plan, skills catalog, and TDD workflow.

#### Scenario: SPEC.md is scannable

- **WHEN** an AI agent reads `openspec/specs/SPEC.md`
- **THEN** it can answer: how many plugins exist, what file triggers each target, where the demo lives, what skills are published

### Requirement: Change folder proposal-design-specs-tasks layout

Every OpenSpec change folder under `openspec/changes/` (i.e. active changes; folders under `openspec/changes/archive/` predate this contract and are exempt) MUST contain `proposal.md`, `design.md`, `tasks.md`, and a `specs/` subdirectory with capability delta files.

#### Scenario: active changes have all four artifacts

- **WHEN** `openspec validate --strict` runs
- **THEN** it reports no missing-artifact errors for any active change folder under `openspec/changes/`

### Requirement: tasks.md maps 1:1 to convoy beads

The `tasks.md` file MUST include a Bead traceability table mapping each section of the file to a convoy bead ID.

#### Scenario: Every task references a bead

- **WHEN** a reviewer cross-references tasks with the convoy board
- **THEN** every task in `tasks.md` has a corresponding bead ID
