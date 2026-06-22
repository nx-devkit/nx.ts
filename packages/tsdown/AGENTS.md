# @nx-devkit/tsdown

Agent guide for working in `packages/tsdown/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```
packages/tsdown/
├── package.json
├── tsdown.config.ts          # entry: src/index.ts, src/plugin.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── index.ts              # re-exports createNodesV2
│   ├── plugin.ts             # createNodesV2 — `**/tsdown.config.ts` → `build` target
│   └── plugin.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
// The plugin currently ships no options; the createNodesV2 signature is parameterless.
export interface NxTsdownPluginOptions {} // {}  reserved for future options
```

## Scope rules

- Touch ONLY `packages/tsdown/`.
- Do NOT modify other plugin packages or the root `nx.json`.
- The plugin MUST skip the workspace root (a `tsdown.config.ts` at `./` is never treated as a project).

## TDD workflow

1. Write a failing `src/plugin.spec.ts` that calls `createNodesV2[1]` against a tmp directory containing a `tsdown.config.ts`.
2. `bun test` → RED.
3. Update `src/plugin.ts` until the test passes.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/tsdown
bun test
bun run build
```