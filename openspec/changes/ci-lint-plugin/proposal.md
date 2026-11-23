# Proposal: @nx-devkit/ci-lint — actionlint + zizmor workflow lint target

## Why

`.github/workflows/*.yml` has no native lint story: actionlint catches
correctness bugs (bad expressions, unknown runners, wrong event shapes) and
zizmor catches CI security issues (unpinned actions, script injection,
over-privileged tokens). Both are repo-wide by nature and useful in literally
every repository — a perfect fit for zero-config inference: workflow files
exist → a cached `lint-ci` target exists.

## What Changes

### NEW package: `packages/ci-lint/`

- **Scope**: `@nx-devkit/ci-lint`
- **Trigger file**: `.github/workflows/*.{yml,yaml}` (workspace root only —
  workflow files are inherently repo-wide)
- **API**: `createNodesV2` (Nx 22+ / 23+)
- **Inferred target**: `lint-ci` on the root project (`.`), `cache: true`,
  `nx:run-commands`, inputs covering the workflow glob plus
  `.github/actionlint.{yml,yaml}` and `zizmor.{yml,yaml}` configs.

### Tool invocation

- Both tools are **optional**: each leg is
  `if command -v <tool> ...; then <run>; else echo <skip>; fi`, joined with
  `&&` so a real lint failure fails the target while a missing tool only
  echoes a skip line.
- `actionlint` is an optional npm peer (`>=1.0.0`); the init generator
  installs it. `zizmor` has no npm package — it installs via pipx/cargo/brew
  and is probed on PATH.
- Options: `targetName`, `actionlint`, `zizmor`, `actionlintArgs`,
  `zizmorArgs`, `zizmorFormat` (`plain`/`json`/`sarif`), `zizmorOutput`
  (redirect path — `zizmor.sarif` for `codeql-action/upload-sarif`).

## Non-goals

- No `lint-ci:fix` target — actionlint findings are rarely auto-fixable
  (deferred per issue #226).
- No registration in root `nx.json` `plugins[]` — dogfooding is a separate
  task.
