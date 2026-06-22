# REVIEW.md

Rules for AI code reviewers (Claude Code Review, GitHub Copilot, etc.) reviewing this repository. Keep this file short; long REVIEW.md dilutes rules.

## Important

Reserve `Important` for issues that are behavior-breaking or have real consequences:

- Behavior-breaking bugs (incorrect logic, broken contracts, data loss, race conditions).
- Security issues (injection, path traversal, unsafe deserialization, leaked secrets, missing input validation on external input).
- Schema/interface drift: an `AGENTS.md` or `schema.json`/`schema.d.ts` definition that no longer matches the source, or vice versa.
- API breaking changes (renamed/removed exports, changed signatures, changed default behavior).
- Missing tests for new public API surface.
- A new public option exposed in plugin code is NOT mirrored in `schema.json`/`schema.d.ts`, the corresponding `AGENTS.md` interface definition, AND any `SKILL.md` that documents options.

## Nit

Reserve `Nit` for naming, comments, and minor refactors. Cap at **5 nits per review**. Do not post nits that don't have a concrete improvement.

## Skip

Do not flag findings in:

- `bun.lock`, `package-lock.json`, any `*.lock` file
- `apps/demo/dist/**`, `**/dist/**`, `**/coverage/**`
- `node_modules/**`
- Auto-generated files under `apps/demo/**/dist/**` and `apps/demo/**/.nx/**`
- `scripts/spec-check.ts` (intentionally minimal, not part of the published API)

## Already enforced by CI

Do not duplicate. These are caught by existing tooling:

- Linting (oxlint, biome)
- Formatting (biome)
- Type errors (tsgo)
- Security hotspots (SonarCloud S-rules in `release.yml`)

## Always check

Repo-specific rules every review should flag with a `file:line` citation:

- `createNodesV2` callbacks must honor their `options` parameter.
- `spawnSync` / `exec` calls must have a timeout.
- `JSON.parse` errors must be distinguished from `readFileSync` FS errors.
- Cross-platform path ops: use `dirname` / `joinPathFragments`, not regex.
- npm lifecycle scripts in `package.json` are not duplicated into placeholder artifacts.

## Verification bar

Before posting any finding, require a `file:line` citation in the source. Do not infer issues from naming, directory structure, or PR description. If you cannot cite the line, do not post it.

## Re-review convergence

After the first review on a PR, suppress new nits. On subsequent reviews, only post new `Important` findings.

## Summary shape

Open the review body with a count line, e.g. `2 factual, 4 style`. When there are no factual issues, lead with "no factual issues".

## Cross-fork rule

The fork PR and the upstream PR reference the same branch and contain the same code. Do not flag divergence between them.

---

## CodeFactor findings (152 total, 5 fixed, 65 excluded via .codefactor.yml, 79 suppressed via dashboard)

CodeFactor uses Oxlint 1.69.0 for JS/TS analysis. The 152 findings break down into categories that fall into three buckets: real code issues we fixed, test-file noise excluded via `.codefactor.yml`, and stylistic rules suppressed via the CodeFactor dashboard UI.

### Summary

| Decision | Count | Files affected |
|----------|-------|----------------|
| fix in code | 5 | generator.ts, plugin.ts, tsdown.config.ts x2 |
| excluded via .codefactor.yml | 65 | *.spec.ts, *.test.ts (3 spec files) |
| suppressed via CodeFactor dashboard | 79 | executor.ts, plugin.ts, generator.ts, index.ts |

### Fixed in code

| # | File:Line | Rule | Description | What I did |
|---|-----------|------|-------------|------------|
| 1 | generators/init/generator.ts:1-2 | eslint/no-duplicate-imports | Two separate `@nx/devkit` imports | Merged into single import with `type` specifiers |
| 2 | plugin.ts:1-3 | eslint/sort-imports | Node imports before @nx/devkit | Reordered: @nx/devkit first, then node:* |
| 3 | plugin.ts:71 | import/no-anonymous-default-export | `export default { ... }` | Named the export: `const plugin = { ... }; export default plugin` |
| 4 | tsdown.config.ts (prepare-for-release):4-12 | eslint/sort-keys | Object keys not alphabetical | Reordered: clean, dts, entry, format |
| 5 | tsdown.config.ts (biome):3-11 | eslint/sort-keys | Object keys not alphabetical | Reordered: clean, deps, dts, entry, format |

### Excluded via .codefactor.yml (test files — 65 findings)

| Rule | Count | Why excluded |
|------|-------|-------------|
| import/no-nodejs-modules | 9 | Tests need `node:fs`, `node:os`, `node:path` |
| eslint/no-magic-numbers | 26 | Test assertions use 0, 1, 2, etc. |
| eslint/func-style | 7 | Tests use function declarations |
| eslint/id-length | 8 | Test variables `r`, `v`, `w` |
| eslint/max-statements | 5 | Test setup is verbose |
| eslint/init-declarations | 5 | Test vars: `let workspace`, `let originalCwd` |
| eslint/sort-imports | 6 | Test import ordering |
| unicorn/no-null | 1 | Test null expectations |
| import/first | 1 | Dynamic import before static type import |
| import/group-exports | 3 | Schema.d.ts interface exports |
| eslint/prefer-destructuring | 1 | Test helper chain |

### Suppressed via CodeFactor dashboard UI (79 findings in source files)

These are stylistic rules that conflict with our codebase conventions. Each must be individually suppressed via the CodeFactor dashboard ("Ignore Issues like this") because `.codefactor.yml` does not support rule-level suppression for oxlint rules.

| Rule | Count | Files | Why suppressed |
|------|-------|-------|----------------|
| eslint/func-style | 21 | executor.ts, plugin.ts, generator.ts | Codebase uses function declarations consistently |
| import/no-named-export | 14 | executor.ts, plugin.ts, generator.ts, index.ts | Nx plugin API requires named exports (createNodesV2, executor, generator) |
| import/no-nodejs-modules | 4 | executor.ts, plugin.ts | Node.js executor/plugin legitimately needs node:fs, node:path, etc. |
| eslint/no-magic-numbers | 3 | executor.ts | Index access (`stdout.split('\n').pop()`) and regex char codes |
| unicorn/no-null | 7 | executor.ts, generator.ts | Explicit null used for error handling, not undefined |
| import/exports-last | 5 | executor.ts, plugin.ts, generator.ts | Named exports precede default export — standard Nx pattern |
| import/group-exports | 2 | plugin.ts | Intentionally separate re-export blocks |
| eslint/sort-imports | 2 | executor.ts | Import ordering already handled by biome |
| eslint/no-ternary | 3 | executor.ts, generator.ts | Ternaries used for readability in short expressions |
| eslint/no-continue | 3 | plugin.ts | Continue used in for-loop for early filter |
| eslint/id-length | 2 | plugin.ts | Short var `r` in regex test |
| eslint/sort-keys | 3 | tsdown.config.ts, generator.ts | Key order intentional for readability |
| eslint/no-await-in-loop | 1 | executor.ts | Sequential npm operations must be ordered |
| import/no-anonymous-default-export | 0 | — | Fixed in code |
| eslint/max-statements | 6 | executor.ts, generator.ts | Complex orchestration functions |
| eslint/max-params | 1 | executor.ts | buildPlaceholderTarball needs 4 params |
| eslint/default-param-last | 1 | plugin.ts | Default param before required — existing pattern |
| eslint/prefer-named-capture-group | 1 | executor.ts | Regex already clear without named groups |
