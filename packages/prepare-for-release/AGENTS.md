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
  trustRepo?: string;           // default: process.env.NPM_TRUST_REPO or "ThePlenkov/nx.ts"
}
```

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
