## 0.1.2 (2026-10-26)

### 🩹 Fixes

- **release:** fix init generator, version flag collision, and workflow NODE_AUTH_TOKEN ([#143](https://github.com/nx-devkit/nx.ts/pull/143), [#137](https://github.com/nx-devkit/nx.ts/issues/137))

### ❤️ Thank You

- Petr Plenkov @ThePlenkov

## 0.1.1 (2026-10-25)

### 🚀 Features

- add monorepo and package generators for typescript preset ([526b81f](https://github.com/nx-devkit/nx.ts/commit/526b81f))
- **release:** the release plan — one version, publish what changed ([#136](https://github.com/nx-devkit/nx.ts/pull/136))

### ❤️ Thank You

- Petr Plenkov @ThePlenkov

## 0.1.0 (2026-10-22)

### 🚀 Features

- ⚠️  **release:** the release version comes from conventional commits ([#135](https://github.com/nx-devkit/nx.ts/pull/135))

### ⚠️  Breaking Changes

- **release:** the release version comes from conventional commits  ([#135](https://github.com/nx-devkit/nx.ts/pull/135))
  footer in the commit body marks the commit as
    breaking (the spec promised it, the parser only looked at the subject);
  - the commit type must be alphabetic, and the description must not be
    empty;
  - a pull request link is only rendered when it is a safe https URL — a
    parenthesis would end the link early and a javascript: URL would be
    executable in a Markdown renderer.
  * fix(release): breaking marker in the changelog, and the docs match the code
  - a breaking change carries a marker in the changelog, so a reader can
    spot the changes that need an update;
  - the proposal, the tasks and the spec name the same bump mapping
    (fix/perf/revert -> patch) and the same version baseline (the highest
    current version among the packages, so none is downgraded);
  - the changelog requirement spells out the format elements the
    repository's changelogs use;
  - stage 1's parity check covers the published set and the versions — the
    tag and release model change in stage 2, with the one-version model."
  A	openspec/changes/release-dogfooding/proposal.md
  A	openspec/changes/release-dogfooding/specs/release-dogfooding/spec.md
  A	openspec/changes/release-dogfooding/tasks.md
  A	packages/release/src/changelog.spec.ts
  A	packages/release/src/changelog.ts
  A	packages/release/src/version.spec.ts
  A	packages/release/src/version.ts

### ❤️ Thank You

- Petr Plenkov @ThePlenkov

## 0.0.22 (2026-10-22)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.21 (2026-10-01)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.20 (2026-09-29)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.19 (2026-09-29)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.18 (2026-09-29)

### 🚀 Features

- connect socket.dev + fix supply-chain findings ([#109](https://github.com/nx-devkit/nx.ts/pull/109))

### ❤️ Thank You

- Devin @devin-ai-integration[bot]
- Petr Plenkov @ThePlenkov

## 0.0.17 (2026-09-28)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.16 (2026-09-28)

### 🚀 Features

- **markdownlint:** @nx-devkit/markdownlint plugin + repo-wide md lint dogfooding ([#108](https://github.com/nx-devkit/nx.ts/pull/108))

### ❤️ Thank You

- Devin @devin-ai-integration[bot]
- Petr Plenkov @ThePlenkov

## 0.0.15 (2026-09-28)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.14 (2026-09-28)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.13 (2026-09-28)

### 🩹 Fixes

- resolve open CodeQL scanning alerts ([#102](https://github.com/nx-devkit/nx.ts/pull/102))

### ❤️ Thank You

- Petr Plenkov @ThePlenkov

## 0.0.12 (2026-09-28)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.11 (2026-09-24)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.10 (2026-09-23)

### 🩹 Fixes

- **deps:** declare @nx/devkit as a dependency, drop nx peer ([#82](https://github.com/nx-devkit/nx.ts/pull/82))

### ❤️ Thank You

- Petr Plenkov @ThePlenkov

## 0.0.9 (2026-09-21)

### 🩹 Fixes

- **release:** point exports at dist and ship schema.json files ([f06d489](https://github.com/nx-devkit/nx.ts/commit/f06d489))

### ❤️ Thank You

- Devin @devin-ai-integration[bot]
- Petr Plenkov @ThePlenkov

## 0.0.8 (2026-09-21)

### 🩹 Fixes

- **tsdown-config:** extend clean:false to all executor-provider packages ([3a92cef](https://github.com/nx-devkit/nx.ts/commit/3a92cef))

### ❤️ Thank You

- Petr Plenkov @ThePlenkov

## 0.0.7 (2026-09-21)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.6 (2026-09-21)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.

## 0.0.5 (2026-09-18)

### 🚀 Features

- per-project changelogs and GitHub releases in the release pipeline ([444ccf2](https://github.com/nx-devkit/nx.ts/commit/444ccf2))

### 🩹 Fixes

- fail changelog step when pushes exhaust retries; EOF newlines ([b934b0f](https://github.com/nx-devkit/nx.ts/commit/b934b0f))

### ❤️ Thank You

- Devin @devin-ai-integration[bot]

## 0.0.3 (2026-09-18)

### 🚀 Features

- **release:** split publish executor into bump/publish/full modes ([5530b16](https://github.com/nx-devkit/nx.ts/commit/5530b16))

### 🩹 Fixes

- **release:** coderabbit round — publish-after-land order, repair paths, dirty-tree guard ([f160402](https://github.com/nx-devkit/nx.ts/commit/f160402))
- **release:** codeant findings — prerelease compare, lockfile staging, branch base, tag order ([b609200](https://github.com/nx-devkit/nx.ts/commit/b609200))
- **release:** attach cause to rethrown JSON parse error (biome) ([4172b53](https://github.com/nx-devkit/nx.ts/commit/4172b53))
- **release:** harden executor — JSON parse guard, semver guards, dirty-tree check, dedupe helpers ([efc43ad](https://github.com/nx-devkit/nx.ts/commit/efc43ad))

### ❤️ Thank You

- Devin @devin-ai-integration[bot]
- Petr Plenkov @ThePlenkov

## 0.0.2 (2026-09-18)

This was a version bump only for @nx-devkit/release to align it with other projects, there were no code changes.
