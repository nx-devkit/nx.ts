# @nx-devkit/biome

Agent guide for working in `packages/biome/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/biome/
├── package.json
├── tsdown.config.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts             # createNodesV2 — biome.json{,c} → `format`, `format-check`, `lint` targets
│   └── plugin.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxBiomePluginOptions {
  /** Run `lint` as part of `nx lint`. Default: false. */
  checkOnLint?: boolean;
  /** Reuse biome's internal cache for `format-check`. Default: true. */
  formatCache?: boolean;
}
```

## Scope rules

- Touch ONLY `packages/biome/`.
- Do NOT modify other plugin packages or the root `nx.json`.
- `format` MUST NOT be cached (it has side effects). `format-check` and `lint` MUST be cached.
- Workspace root `biome.json` is intentionally skipped.

## TDD workflow

1. Write failing `src/plugin.spec.ts`: a project containing `biome.json` must produce three targets; workspace-root `biome.json` must be skipped.
2. `bun test` → RED.
3. Implement in `src/plugin.ts`.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/biome
bun test
bun run build
```
