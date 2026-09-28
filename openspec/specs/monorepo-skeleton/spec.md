# monorepo-skeleton Specification

## Purpose

Defines the baseline workspace layout: a private bun-workspaces root, shared
tooling configs (`tsconfig.base.json`, `biome.json`, `.oxlintrc.json`,
`nx.json`), and the husky pre-commit hook that formats staged changes.

## Requirements

### Requirement: Root package is private bun workspace

The repository root `package.json` MUST be `private: true` and MUST declare `workspaces` containing the three glob patterns `packages/*`, `apps/*`, `skills/*`.

#### Scenario: Workspaces declared correctly

- **WHEN** a developer runs `bun install` at the repo root
- **THEN** every package in `packages/` is linked and resolvable from `@nx-devkit/*` import paths

### Requirement: Root tooling configuration

The repository root MUST ship `tsconfig.base.json`, `biome.json`, `.oxlintrc.json`, `nx.json`, and `.gitignore` so that downstream packages can extend the base TS config and so that biome/oxlint/nx operate on a consistent root.

#### Scenario: TS strict mode is on

- **WHEN** any package extends `tsconfig.base.json`
- **THEN** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, and `exactOptionalPropertyTypes` are all `true`

### Requirement: Nx with bun package manager

The repository's `nx.json` MUST declare `packageManager: "bun@…"` and a `plugins` array registering the workspace's in-repo plugins via their `src/plugin.ts` paths (entries MAY carry an `options` object). The installed Nx major version is tracked by `package.json`, not pinned in `nx.json`.

#### Scenario: nx.json schema is valid

- **WHEN** a developer runs `bunx nx show project .`
- **THEN** Nx accepts the configuration without error

### Requirement: Husky pre-commit runs biome format

The repository MUST ship `.husky/pre-commit` that runs `bunx biome format --write --no-errors-on-unmatched` followed by `git add -u` on every commit.

#### Scenario: Pre-commit formats and re-stages files

- **WHEN** a developer commits any file
- **THEN** biome rewrites all matching files in the repo to the formatter config, and `git add -u` re-stages any formatting changes before the commit is created

### Requirement: License preserved

The `LICENSE` file MUST remain unchanged from the upstream fork (MIT, Copyright nx-devkit, 2026).

#### Scenario: License file is byte-identical to upstream

- **WHEN** the diff between upstream `LICENSE` and this repo's `LICENSE` is computed
- **THEN** the diff is empty
