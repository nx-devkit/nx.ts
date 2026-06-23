# @nx-devkit/oxlint

Agent guide for working in `packages/oxlint/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```
packages/oxlint/
├── package.json
├── tsdown.config.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts             # createNodesV2 — `.oxlintrc.*` → `lint` target
│   └── plugin.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxOxlintPluginOptions {
  /** Optional override for the .oxlintrc config file name. Default: ".oxlintrc.json". */
  configFile?: string;
}
```

## Scope rules

- Touch ONLY `packages/oxlint/`.
- Do NOT modify other plugin packages or the root `nx.json`.
- The plugin must skip the workspace root.
- `.oxlintrc.*` files larger than 1 MiB are ignored.

## TDD workflow

1. Write failing `src/plugin.spec.ts` covering: workspace-root skip, large config ignored, normal config infers a `lint` target.
2. `bun test` → RED.
3. Update `src/plugin.ts` to pass.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/oxlint
bun test
bun run build
```