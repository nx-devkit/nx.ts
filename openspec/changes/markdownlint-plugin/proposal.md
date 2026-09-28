# Proposal: @nx-devkit/markdownlint plugin

## Why

The workspace lints Markdown via `markdownlint-cli2`, but there is no standalone
plugin — the `lint` target is hardcoded inside `@nx-devkit/skill` and only
covers skill directories. A dedicated plugin makes Markdown linting available to
any project or workspace that keeps a `.markdownlint*` config, and dogfoods our
own root config on every md file, not just skills.

## What changes

- New package `packages/markdownlint` (`@nx-devkit/markdownlint`).
- `createNodesV2` triggers on `**/.markdownlint*.{json,jsonc,yaml,yml,cjs,mjs}`.
- Each config directory infers a `lint-md` target on the owning project:
  `markdownlint-cli2 '<root>/**/*.md' '#**/node_modules/**'` with `--config <cfg>`
  only for `.markdownlint.*` rules configs (`.markdownlint-cli2.*` runner
  configs are auto-discovered and never passed to `--config`).
- Optional `lint-md:fix` target (`--fix`), plus `targetName`/`fixTargetName`/
  `ignoreGlobs` options.
- Standard `init` generator (`nx add @nx-devkit/markdownlint`).

## Non-goals

- No custom executor — `nx:run-commands` is sufficient.
- No markdownlint config programmability; we shell out to markdownlint-cli2.
