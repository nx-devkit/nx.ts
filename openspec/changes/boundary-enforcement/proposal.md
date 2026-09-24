# Proposal: Module-boundary enforcement (`check-boundaries`)

## Why

`@nx/enforce-module-boundaries` is the deepest reason teams adopt Nx — declaring that `type:app` may import `type:feature` but never the reverse, and having CI actually enforce it. Today it is ESLint-only (`@nx/eslint` rule), with an experimental port inside the official `@nx/oxlint` package as an oxlint JS plugin (unstable API surface).

A workspace running the nx-devkit stack — oxlint or Biome, no ESLint — has **no boundary enforcement at all**. This is the single largest capability gap between nx-devkit and the official plugin set.

The goal: a linter-agnostic `check-boundaries` Nx target that works regardless of which linter owns `lint` — or whether one is registered at all.

## What Changes

### New package: `@nx-devkit/boundaries`

- **ADD** a `createNodesV2` plugin that infers a single workspace-root `check-boundaries` target when any project in the graph declares `tags` (via the standard `"nx": {"tags": [...]}` field in `package.json` — no `project.json` required, matching nx-devkit's inference philosophy).
- **ADD** a `check-boundaries` executor that:
  1. Loads the project graph via `createProjectGraphAsync`.
  2. Collects each project's `tags` (Nx merges `package.json` `nx` metadata into inferred projects).
  3. Scans source files for import specifiers — `import`, `export ... from`, dynamic `import()`, `require()` — using the TypeScript parser.
  4. Resolves each specifier to a target project (workspace-relative paths and tsconfig path mappings).
  5. Evaluates `depConstraints` and reports violations with file:line.
- **ADD** `depConstraints` plugin option in `nx.json`:

```jsonc
{
  "plugin": "@nx-devkit/boundaries",
  "options": {
    "depConstraints": [
      { "sourceTag": "type:app", "onlyDependOnLibsWithTags": ["type:feature", "type:util"] },
      { "sourceTag": "type:feature", "onlyDependOnLibsWithTags": ["type:feature", "type:util"] }
    ]
  }
}
```

- Semantics mirror the official rule: `sourceTag` matches the importing project's tags; `onlyDependOnLibsWithTags` whitelists target project tags; unconstrained sources/targets are allowed by default (permissive default matching ESLint rule behavior).

## Non-goals

- **Not an oxlint/Biome/ESLint plugin.** Linter plugins bind us to unstable APIs (oxlint `jsPlugins` is excluded from semver) and split enforcement across tools. An executor is linter-agnostic — correct for a stack where lint ownership is itself precedence-based.
- **No circular-dependency detection** (official rule's `checkCircularDeps`) in v1 — separate bead if wanted.
- **No `bannedExternalImports` / npm-package constraints** in v1 — project-to-project only.
- **No auto-fix.** Boundaries violations are architectural; the executor reports, humans decide.

## Interop note

Consumers who *do* run official `@nx/oxlint` can already use its `boundaries-plugin`; this package exists for the ESLint-free / Biome path and for consumers who want a dedicated CI check independent of their linter.
