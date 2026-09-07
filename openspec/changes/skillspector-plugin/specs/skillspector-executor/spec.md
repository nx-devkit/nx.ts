# Spec: skillspector-executor

## ADDED Requirements

### Requirement: SKILL.md triggers scan target inference
The plugin MUST use `createNodesV2` with trigger file `**/SKILL.md`. For each `SKILL.md` found, a `scan` target is inferred using the `@nx-devkit/skillspector:scan` executor.

#### Scenario: Scan target inferred
- **WHEN** a workspace contains `skills/code-review/act/SKILL.md`
- **THEN** a `scan` target is inferred for project `skills-code-review-act-<hash>` (where `<hash>` is the first 8 hex chars of SHA-256 of the full project path, matching `@nx-devkit/skill`) with executor `@nx-devkit/skillspector:scan`

### Requirement: Scan executor runs SkillSpector CLI
The executor MUST spawn `skillspector scan <path>` with `--no-llm` by default and `--format json` to capture findings.

#### Scenario: Default invocation
- **WHEN** the scan executor runs with default options
- **THEN** it spawns `skillspector scan <skill-path> --no-llm --format json`

#### Scenario: LLM enabled
- **WHEN** `noLlm: false` is set
- **THEN** the executor does NOT pass `--no-llm`

#### Scenario: Baseline passed
- **WHEN** `baseline: ".skillspector-baseline.yaml"` is set
- **THEN** the executor passes `--baseline .skillspector-baseline.yaml`

### Requirement: SARIF 2.1.0 output
The executor MUST produce a SARIF 2.1.0 report when `sarif` option is set, preserving per-issue metadata (category, confidence, remediation, code_snippet) under `properties`.

#### Scenario: SARIF written
- **WHEN** `sarif: "report.sarif"` is set and findings exist
- **THEN** a SARIF 2.1.0 file is written with one run containing all findings as results

### Requirement: GitHub Actions annotations for code findings
The executor MUST emit `::error file=<path>,line=<n>::<rule_id>: <message>` workflow commands for findings in code files (`.ts`, `.js`, `.py`, `.sh`, `.yml`, `.json`). Findings in documentation files (`.md`, `.txt`) MUST NOT be emitted as annotations. The executor MUST escape scanner-controlled values (file paths, rule IDs, messages) before constructing each annotation: encode `%` as `%25`, newlines and carriage returns as literal `\\n`/`\\r`, and remove or encode any other workflow-command delimiters to prevent annotation injection or corruption.

#### Scenario: Code finding annotated
- **WHEN** a finding is in `scripts/foo.ts` at line 42 for project `skills-code-review-act-<hash>`
- **THEN** an annotation `::error file=scripts/foo.ts,line=42::SQP-1: <message>` is written to `annotations-skills-code-review-act-<hash>.txt`

#### Scenario: Doc finding not annotated
- **WHEN** a finding is in `references/guide.md`
- **THEN** no annotation is emitted for this finding

### Requirement: Annotations written to per-project file
The executor MUST write annotations to a **per-project** file (`annotations-<projectName>.txt` in the workspace root) rather than stdout, because Nx prefixes stdout with ANSI-colored project names that break GitHub workflow command parsing. Per-project files prevent concurrent Nx runs from interleaving writes. The CI workflow concatenates all `annotations-*.txt` files after the Nx run.

#### Scenario: Annotations file path
- **WHEN** the executor runs with annotations enabled for project `skills-code-review-act-<hash>`
- **THEN** annotations are written to `annotations-skills-code-review-act-<hash>.txt`

### Requirement: Fail-on-error policy
When `failOnError: true` (default), the executor MUST return `{ success: false }` if any HIGH or CRITICAL severity finding exists. Otherwise it returns `{ success: true }`.

#### Scenario: High finding fails
- **WHEN** findings include a HIGH severity issue and `failOnError: true`
- **THEN** the executor returns `{ success: false }`

#### Scenario: Low finding succeeds
- **WHEN** findings include only LOW/MEDIUM severity issues and `failOnError: true`
- **THEN** the executor returns `{ success: true }`

### Requirement: Workspace root skipped
The plugin MUST NOT infer a scan target for `SKILL.md` at the workspace root.

#### Scenario: Root SKILL.md ignored
- **WHEN** `SKILL.md` exists at the workspace root
- **THEN** no scan target is inferred for it

### Requirement: Coexistence with @nx-devkit/skill
The plugin MUST coexist with `@nx-devkit/skill` when both are registered. `@nx-devkit/skill` adds `build`/`lint`/`validate`/`os-check`/`size-check` targets; `@nx-devkit/skillspector` adds `scan`. No target name conflicts.

#### Scenario: Both plugins registered
- **WHEN** `nx.json` registers both `@nx-devkit/skill` and `@nx-devkit/skillspector`
- **THEN** each skill project has `build`, `lint`, `validate`, `os-check`, `size-check`, AND `scan` targets

### Requirement: Custom scan target name
The plugin MUST accept `scanTargetName` option to override the default `scan` target name.

#### Scenario: Custom target name
- **WHEN** `scanTargetName: "security-scan"` is set
- **THEN** the scan target is named `security-scan` instead of `scan`
