# Spec: workspace-dogfooding

## ADDED Requirements

### Requirement: Skills are first-class Nx projects
Every `skills/*/SKILL.md` MUST produce an inferred project exposing `build`,
`lint`, `validate`, `os-check`, `size-check`, and `scan` targets, and all of
them MUST pass in CI.

#### Scenario: Skill lifecycle targets run
- **WHEN** `nx run-many -t validate,os-check,size-check --projects 'skills-*'` runs
- **THEN** all skill projects pass

#### Scenario: SkillSpector scans run
- **WHEN** `nx run-many -t scan --projects 'skills-*'` runs with a configured
  `skillspectorBin`
- **THEN** every skill is scanned and the run fails on high/critical findings

### Requirement: Diagrams render through the diagrams plugin
`docs/diagrams/*.mmd` MUST be rendered to SVG by the inferred `diagrams`
target of `@nx-devkit/diagrams` (Kroki backend by default; the workspace
pins `outputDir: "{fileDir}/dist"`).

#### Scenario: Diagram build
- **WHEN** `nx run-many -t diagrams` runs
- **THEN** `docs/diagrams/dist/*.svg` is produced

### Requirement: CI executes real inferred targets
`.github/workflows/ci.yml` MUST run `nx run-many -t lint,build,test,typecheck`
(which includes skill lint/build), a separate `nx run-many -t diagrams` for
diagram rendering, the skill validation targets, and SkillSpector scans — not
only package-level tests.

#### Scenario: CI covers skills and diagrams
- **WHEN** a PR is opened
- **THEN** skill lifecycle targets, SkillSpector scans, and diagram renders
  all execute in the pipeline

### Requirement: Release preparation uses the repo's own plugin
New publishable packages MUST be bootstrapped via `nx run-many -t
prepare-for-release` (the `@nx-devkit/prepare-for-release` executor) run
locally with npm credentials — NOT in the OIDC-only release workflow, since
npm trusted publishing cannot perform a package's first publish. The
executor MUST stay idempotent and MUST NOT mutate source manifests.

#### Scenario: New package gets a placeholder
- **WHEN** a publishable package has never been published and a maintainer
  runs the target locally (EOTP web-auth or token in `.npmrc`)
- **THEN** a `0.0.0` placeholder tarball built in a temp dir is published
  without mutating the source manifest
