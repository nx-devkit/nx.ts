# @nx-devkit/prepare-for-release

Agent guide for working in `packages/prepare-for-release/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```
packages/prepare-for-release/
├── package.json            # @nx-devkit/prepare-for-release
├── tsdown.config.ts        # entry: index, plugin, executors/publish-placeholder/executor, generators/init/generator
├── vitest.config.ts
├── src/
│   ├── index.ts            # public surface
│   ├── plugin.ts           # createNodesV2: detects `tools/project.json` referencing our executor
│   ├── plugin.spec.ts
│   ├── executors/
│   │   └── publish-placeholder/
│   │       ├── executor.ts
│   │       ├── publish-placeholder.spec.ts
│   │       ├── schema.json
│   │       └── schema.d.ts
│   └── generators/
│       └── init/
│           ├── generator.ts
│           └── schema.json
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxPrepareForReleaseOptions {
  scope?: string[];             // default: every package under packages/*
  placeholderTag?: string;      // default: "placeholder"
  placeholderVersion?: string;  // default: "0.0.0"
  registry?: string;            // default: "https://registry.npmjs.org/"
  dryRun?: boolean;             // default: false
  trust?: boolean;              // default: false — run `npm trust github` for all packages including already-published (requires MFA)
  trustRepo?: string;           // default: process.env.NPM_TRUST_REPO or process.env.GITHUB_REPOSITORY or "nx-devkit/nx.ts"
  packageJson?: string;         // default: unset — when set, process only this manifest (per-package inferred target); unset = scan packages/* (tools-project mode)
}
```

## Inference modes

`createNodesV2` globs `**/{package,project}.json`:

- `project.json` referencing `publish-placeholder` → tools-project target (legacy mode, scans `packages/*`).
- `package.json` with `name` + `private !== true` → per-package `prepare-for-release` target with `options.packageJson`. This is the primary mode: `nx run-many -t prepare-for-release` processes every publishable package; already-published packages skip via `npm view`. Opt out with `private: true` or the plugin `exclude` option.

## EOTP web-auth recovery

`npm publish` in non-TTY output masks the EOTP auth URL (`https://www.npmjs.com/auth/cli/***`). The executor detects `EOTP`, replicates the publish PUT with `npm-auth-type: web` (global `fetch`) to get the real `authUrl`/`doneUrl`, prints `authUrl`, polls `doneUrl` for the OTP (5 min), and retries `npm publish --otp`. Token is read from `<cwd>/.npmrc` or `~/.npmrc`.

## Scope rules

- Touch ONLY `packages/prepare-for-release/`.
- Do NOT modify other plugin packages.
- Do NOT modify `nx.json` directly here; the root `nx.json` is owned by another bead.
- The plugin MUST never mutate the consuming package's `package.json` on disk. The placeholder tarball is built in a temp dir.

## TDD workflow

1. Write failing `*.spec.ts` (vitest). Mock `node:child_process` for `spawnSync`. Use real `mkdtempSync` for the temp dir.
2. `bun test` → RED.
3. Implement the smallest change in `executor.ts` / `generator.ts` / `plugin.ts` that makes the test pass.
4. `bun run build` → GREEN.
5. Commit.

## Verification commands

```bash
cd packages/prepare-for-release
bun test
bun run build
```
