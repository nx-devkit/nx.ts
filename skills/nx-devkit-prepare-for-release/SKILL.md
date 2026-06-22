---
name: nx-devkit-prepare-for-release
description: General-purpose Nx tool plugin that bootstraps a workspace of packages onto npm by publishing 0.0.0 placeholders and emitting `npm trust github` commands for OIDC trusted publishing.
---

# @nx-devkit/prepare-for-release

Bootstrap a workspace of packages onto the npm registry by publishing minimal `0.0.0` placeholders. The executor is **idempotent** — already-published packages are skipped — and **never mutates the source `package.json`** (the placeholder tarball is built in a temp dir).

## When to Use

Use this skill when:

- You are adding a brand-new package to an Nx monorepo that needs to exist on npm before OIDC trusted publishing can be set up.
- You need to bootstrap a fresh consumer workspace before the first real release.
- You want to preview what would be published (`--dryRun`).

## Install

```bash
bun add -D @nx-devkit/prepare-for-release
```

## Init

```bash
bunx nx g @nx-devkit/prepare-for-release:init
```

This adds the plugin to `nx.json` and creates a `tools` project with a `prepare-for-release` target.

## Run

```bash
bunx nx run tools:prepare-for-release
```

Pass options:

```bash
bunx nx run tools:prepare-for-release \
  --placeholderTag=alpha \
  --placeholderVersion=0.0.1 \
  --registry=https://registry.npmjs.org/ \
  --dryRun
```

## Options

```ts
export interface NxPrepareForReleaseOptions {
  scope?: string[];             // default: derived from packages/* names
  placeholderTag?: string;      // default: "placeholder"
  placeholderVersion?: string;  // default: "0.0.0"
  registry?: string;            // default: "https://registry.npmjs.org/"
  dryRun?: boolean;             // default: false
}
```

## Example output

```
[@nx-devkit/prepare-for-release] Checking 4 packages
[@nx-devkit/prepare-for-release] @nx-devkit/tsdown: 404 → publishing 0.0.0 placeholder
[@nx-devkit/prepare-for-release] @nx-devkit/oxlint: 404 → publishing 0.0.0 placeholder
[@nx-devkit/prepare-for-release] @nx-devkit/biome: 0.5.0 already on registry, skipping
[@nx-devkit/prepare-for-release] @nx-devkit/typescript: 404 → publishing 0.0.0 placeholder

Published: @nx-devkit/tsdown, @nx-devkit/oxlint, @nx-devkit/typescript
Skipped:   @nx-devkit/biome

Run these locally (requires MFA) to enable GitHub OIDC trusted publishing:

  npm trust github --file .github/workflows/release.yml --owner ThePlenkov --repo nx.ts @nx-devkit/tsdown
  npm trust github --file .github/workflows/release.yml --owner ThePlenkov --repo nx.ts @nx-devkit/oxlint
  npm trust github --file .github/workflows/release.yml --owner ThePlenkov --repo nx.ts @nx-devkit/typescript
```

## Why npm, not bun, for the placeholder publish

`bun publish` does not yet support npm OIDC trusted publishing. The CI release workflow uses `npx nx release publish` (which invokes the npm CLI). The executor uses the npm CLI directly so the bootstrap flow matches what CI will do afterwards.

## What the executor guarantees

- **Idempotent**: `npm view <name> version` is consulted before any pack/publish. A package already on the registry is silently skipped.
- **Source package.json untouched**: bytes are read before, then again after — must be identical.
- **Temp dir cleanup**: the placeholder tarball directory is removed in `finally`.
- **MFA-aware**: the user must run `npm trust github` themselves; the executor prints the exact commands to run.

## How it works

`createNodesV2` matches `**/project.json`. For each match, it checks whether the project references `@nx-devkit/prepare-for-release:publish-placeholder` as one of its targets. If so, it re-affirms a `prepare-for-release` target pointing at the executor. The init generator creates that `tools` project on demand.

See `packages/prepare-for-release/src/executors/publish-placeholder/executor.ts`.

## Build & test

```bash
cd packages/prepare-for-release
bun run build
bun test
```

## License

MIT