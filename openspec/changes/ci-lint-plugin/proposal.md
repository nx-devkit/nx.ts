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
  `.github/actionlint.{yml,yaml}`, `.github/zizmor.{yml,yaml}` and
  `zizmor.{yml,yaml}` configs, plus a `{runtime}` input per enabled tool
  hashing its `--version` so installing/upgrading a tool busts the cache.

### Tool invocation

- Both tools are **optional**: each leg probes the tool on PATH
  (`command -v` on POSIX, `where` on cmd.exe — the command is generated for
  the platform shell) and echoes a skip line when it is missing. Legs never
  short-circuit: a failed run flips a shared flag and the trailing check
  fails the target after every installed tool ran.
- Neither tool is installed by the init generator: `zizmor` has no npm
  package (pipx/cargo/brew) and npm's `actionlint` is a WASM API that does
  not put the CLI on PATH; the checklist points at brew/go/scoop.
- Options: `targetName`, `actionlint`, `zizmor`, `actionlintArgs`,
  `zizmorArgs`, `zizmorFormat` (`plain`/`json`/`sarif`), `zizmorOutput`
  (redirect path — `zizmor.sarif` for `codeql-action/upload-sarif`).

## Non-goals

- No `lint-ci:fix` target — actionlint findings are rarely auto-fixable
  (deferred per issue #226).
- No registration in root `nx.json` `plugins[]` — dogfooding is a separate
  task.
