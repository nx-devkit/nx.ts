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

## Setup

Register the plugin in `nx.json` — no project.json or init generator needed:

```jsonc
{ "plugins": ["@nx-devkit/prepare-for-release"] }
```

`createNodesV2` infers a `prepare-for-release` target on every non-root `package.json` that has a `name` and is not `private: true`. Opt out with `"private": true`, the plugin `exclude` option, or `packageTargets: false` (keeps only the legacy `tools` project from `nx g @nx-devkit/prepare-for-release:init`).

## Run

```bash
bunx nx run-many -t prepare-for-release
```

Each target processes exactly one package; already-published packages skip via `npm view`. Pass options:

```bash
bunx nx run-many -t prepare-for-release \
  --placeholderTag=alpha \
  --placeholderVersion=0.0.1 \
  --registry=https://registry.npmjs.org/ \
  --trust \
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
  trust?: boolean;              // default: false — run `npm trust github` for all packages including already-published (requires MFA)
  trustRepo?: string;           // default: process.env.NPM_TRUST_REPO or process.env.GITHUB_REPOSITORY or "nx-devkit/nx.ts"
}
```

## Example output

`nx run-many -t prepare-for-release` runs one executor per package target, so output appears as per-package blocks. An unpublished package:

```text
  npm requires one-time authorization for @nx-devkit/tsdown.
  Open this URL to approve the publish:

    https://www.npmjs.com/auth/cli/…

  Waiting for approval...

Published: @nx-devkit/tsdown

Run these locally (requires MFA) to enable GitHub OIDC trusted publishing:

  npm trust github @nx-devkit/tsdown --file release.yml --repo nx-devkit/nx.ts --allow-publish --yes
```

An already-published package:

```text
Skipped:   @nx-devkit/biome
```

## Why npm, not bun, for the placeholder publish

`bun publish` does not yet support npm OIDC trusted publishing. The CI release workflow uses `npx nx release publish` (which invokes the npm CLI). The executor uses the npm CLI directly so the bootstrap flow matches what CI will do afterwards.

## What the executor guarantees

- **Idempotent**: `npm view <name> version` is consulted before any pack/publish. A package already on the registry is silently skipped.
- **Source package.json untouched**: bytes are read before, then again after — must be identical.
- **Temp dir cleanup**: the placeholder tarball directory is removed in `finally`.
- **MFA-aware**: when `trust` is true, the executor runs `npm trust github`; otherwise, it prints the exact commands to run.

## How it works

`createNodesV2` globs `**/{package,project}.json`: non-root `package.json` files with `name` + `private !== true` get a per-package target (`options.packageJson` scopes the executor to that manifest); a `project.json` referencing `publish-placeholder` gets the legacy tools-mode target that scans `packages/*` — suppressed whenever per-package targets exist so nothing is processed twice.

`npm publish` masking the EOTP approval URL (`https://www.npmjs.com/auth/cli/***`) is handled automatically: the executor detects `EOTP`, fetches the real `authUrl`/`doneUrl` via the npm web-auth flow, prints the URL, polls for the OTP (5 min), and retries with `--otp`. Auth tokens are read from `.npmrc` host-scoped entries only (or a truly unscoped `_authToken=` line) — a token for another registry is never sent.

See `packages/prepare-for-release/src/executors/publish-placeholder/executor.ts`.

## Build & test

```bash
cd packages/prepare-for-release
bun run build
bun test
```

## License

MIT
