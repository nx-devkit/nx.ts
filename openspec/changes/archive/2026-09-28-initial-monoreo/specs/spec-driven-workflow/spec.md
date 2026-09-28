# Spec: spec-driven-workflow

## ADDED Requirements

### Requirement: OpenSpec initialized with kilocode tool
The repository MUST be initialized with OpenSpec using the `kilocode` tool flag so that the agent receives the matching slash-command set.

#### Scenario: openspec config exists
- **WHEN** a developer inspects `openspec/config.yaml`
- **THEN** it declares `schema: spec-driven` and references the kilocode tool

### Requirement: SPEC.md captures full architecture
The file `openspec/specs/SPEC.md` MUST describe purpose, architecture (4 tool plugins + 1 preset), file-trigger to target inference matrix, demo workspace plan, skills catalog, TDD workflow, and two-PR strategy.

#### Scenario: SPEC.md is scannable
- **WHEN** an AI agent reads `openspec/specs/SPEC.md`
- **THEN** it can answer: how many plugins exist, what file triggers each target, where the demo lives, what skills are published

### Requirement: Change folder proposal-design-specs-tasks layout
Every OpenSpec change folder MUST contain `proposal.md`, `design.md`, `tasks.md`, and a `specs/` subdirectory with capability delta files.

#### Scenario: initial-monoreo has all four artifacts
- **WHEN** `openspec validate` runs
- **THEN** it reports no missing-artifact errors for `openspec/changes/initial-monoreo/`

### Requirement: tasks.md maps 1:1 to convoy beads
The `tasks.md` file MUST include a Bead traceability table mapping each section of the file to a convoy bead ID.

#### Scenario: Every task references a bead
- **WHEN** a reviewer cross-references tasks with the convoy board
- **THEN** every task in `tasks.md` has a corresponding bead ID
