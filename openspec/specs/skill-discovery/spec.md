# skill-discovery Specification

## Purpose

Defines the `@nx-devkit/skill` inference plugin: every `SKILL.md` in a
subdirectory becomes a project with plugin-inferred `build` (the skills
compiler), `lint`, `validate`, `os-check`, and `size-check` targets.

## Requirements

### Requirement: SKILL.md triggers project inference

The plugin MUST use `createNodesV2` with trigger file `**/SKILL.md`. For each `SKILL.md` found (excluding the workspace root and anything under `node_modules/`), a project is inferred with a collision-resistant name derived from the full relative path (slashes replaced with dashes, plus the first 12 hex chars of SHA-256 of the full path as a suffix) and the skill directory as project root.

#### Scenario: Skill discovered

- **WHEN** a workspace contains `skills/code-review/act/SKILL.md`
- **THEN** a project named `skills-code-review-act-<hash>` is inferred with root `skills/code-review/act`, where `<hash>` is the first 12 hex chars of SHA-256 of `skills/code-review/act`

#### Scenario: Collision-resistant naming — same dashed form, different paths

- **WHEN** a workspace contains both `skills/a-b/SKILL.md` and `skills/a/b/SKILL.md`
- **THEN** two distinct projects are inferred with names `skills-a-b-<hash1>` and `skills-a-b-<hash2>` (same dashed prefix, different hash suffixes)

### Requirement: Build target inferred

The plugin MUST infer a `build` target for each skill project using the `@nx-devkit/skill:build` executor with `target: "skills-sh"` and `outDir: ".build/skills/{projectName}"` defaults.

#### Scenario: Build target

- **WHEN** a skill project is discovered
- **THEN** a `build` target exists with executor `@nx-devkit/skill:build`, cache enabled, outputs `{workspaceRoot}/.build/skills/{projectName}`

### Requirement: Lint target inferred

The plugin MUST infer a `lint` target using `markdownlint-cli2`. The `--config .markdownlint.json` flag is added only when that file exists at the workspace root — consumers without one get markdownlint defaults instead of a missing-config error.

#### Scenario: Lint target with workspace config

- **WHEN** a skill project is discovered and `{workspaceRoot}/.markdownlint.json` exists
- **THEN** a `lint` target exists with command `markdownlint-cli2 '{projectRoot}/**/*.md' --config .markdownlint.json`, cache enabled

#### Scenario: Lint target without workspace config

- **WHEN** a skill project is discovered and no `.markdownlint.json` exists at the workspace root
- **THEN** the `lint` command is `markdownlint-cli2 '{projectRoot}/**/*.md'` with no `--config` flag

### Requirement: Validate target inferred

The plugin MUST infer a `validate` target that checks SKILL.md frontmatter and metadata schemas, backed by the `@nx-devkit/skill:validate` executor bundled in the package (no workspace-level script required).

#### Scenario: Validate target

- **WHEN** a skill project is discovered
- **THEN** a `validate` target exists with executor `@nx-devkit/skill:validate`, the skill directory passed via the `path` option, cache enabled, inputs including `SKILL.md` and `agents/openai.yaml`

### Requirement: OS-check target inferred

The plugin MUST infer an `os-check` target that verifies no hardcoded absolute paths or OS-specific commands, backed by the bundled `@nx-devkit/skill:os-check` executor.

#### Scenario: OS-check target

- **WHEN** a skill project is discovered
- **THEN** an `os-check` target exists with executor `@nx-devkit/skill:os-check`, cache enabled

### Requirement: Size-check target inferred

The plugin MUST infer a `size-check` target that verifies the skill stays within a size budget, backed by the bundled `@nx-devkit/skill:size-check` executor.

#### Scenario: Size-check target

- **WHEN** a skill project is discovered
- **THEN** a `size-check` target exists with executor `@nx-devkit/skill:size-check`, cache enabled

### Requirement: Workspace root skipped

The plugin MUST NOT infer a project for a `SKILL.md` at the workspace root.

#### Scenario: Root SKILL.md ignored

- **WHEN** `SKILL.md` exists at the workspace root (not in a subdirectory)
- **THEN** no project is inferred for it

### Requirement: node_modules skipped

The plugin MUST NOT infer projects for `SKILL.md` files inside `node_modules/`.

#### Scenario: node_modules SKILL.md ignored

- **WHEN** `node_modules/some-pkg/SKILL.md` exists
- **THEN** no project is inferred for it

### Requirement: Custom target names via options

The plugin MUST accept options to override default target names (`buildTargetName`, `lintTargetName`, `validateTargetName`, `osCheckTargetName`, `sizeCheckTargetName`).

#### Scenario: Custom build target name

- **WHEN** `buildTargetName: "compile"` is set
- **THEN** the build target is named `compile` instead of `build`

### Requirement: Custom build inputs via options

The plugin MUST accept a `skillInputs` option: an array of additional input globs appended to the `build` target's `inputs`, so consumers can declare extra files that invalidate the build cache.

#### Scenario: Additional inputs wired in

- **WHEN** `skillInputs: ["{projectRoot}/extra/**"]` is set
- **THEN** the inferred `build` target's `inputs` include `{projectRoot}/extra/**` in addition to the defaults

### Requirement: Build executor compiles skills

The `@nx-devkit/skill:build` executor MUST compile a skill directory to a specified distribution target (skills-sh, claude, codex, agents, obsidian).

#### Scenario: Compile to skills-sh

- **WHEN** the build executor runs with `target: "skills-sh"` and `outDir: "./dist/act"`
- **THEN** the skill is compiled and written to `./dist/act/` in skills-sh format

#### Scenario: Invalid target fails

- **WHEN** the build executor runs with `target: "invalid"`
- **THEN** the executor returns `{ success: false }`
