# @nx-devkit/vitest

Agent guide for working in `packages/vitest/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```
packages/vitest/
├── package.json
├── tsdown.config.ts          # entry: src/index.ts, src/plugin.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── index.ts              # re-exports createNodesV2
│   ├── plugin.ts             # createNodesV2 — `**/vitest.config.*` → test targets
│   └── plugin.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
// The plugin currently ships no options; the createNodesV2 signature is parameterless.
export interface NxVitestPluginOptions {} // {} reserved for future options
```

## Scope rules

- Touch ONLY `packages/vitest/`.
- Do NOT modify other plugin packages or the root `nx.json`.
- The plugin MUST skip the workspace root.
- Target shape comes from `inferVitestTargets` in `@nx-devkit/internal` — change it there, not here.

## TDD workflow

1. Write a failing `src/plugin.spec.ts` covering: project inference, three targets, skip rules.
2. `bun test` → RED.
3. Update `src/plugin.ts` to pass.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/vitest
bun test
bun run build
```
