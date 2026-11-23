# @nx-devkit/oxfmt

Agent guide for working in `packages/oxfmt/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/oxfmt/
├── package.json
├── tsdown.config.ts
├── vitest.config.ts
├── tsconfig.json
├── generators.json
├── src/
│   ├── plugin.ts             # createNodesV2 — .oxfmtrc.{json,jsonc} / oxfmt.config.{ts,mts} → `format`, `format-check` targets
│   ├── plugin.spec.ts
│   └── generators/init/      # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface OxfmtPluginOptions {
  formatCommand?: string; // default "oxfmt --write ."
  formatCheckCommand?: string; // default "oxfmt --check ."
}
```

## Scope rules

- Touch ONLY `packages/oxfmt/`.
- Do NOT modify other plugin packages or the root `nx.json`.
- `format` MUST NOT be cached (it has side effects). `format-check` MUST be cached.
- Workspace-root `.oxfmtrc.*`/`oxfmt.config.*` is intentionally skipped.
- Config discovery mirrors oxfmt's own search set: `.oxfmtrc.json`, `.oxfmtrc.jsonc`, `oxfmt.config.ts`, `oxfmt.config.mts` — no other extensions, no `package.json` key.
- oxfmt allows one config per directory; first glob hit wins the project entry.

## TDD workflow

1. Write failing `src/plugin.spec.ts`: a project containing `.oxfmtrc.json` must produce `format`/`format-check` targets; workspace-root configs must be skipped.
2. `bun run test` → RED.
3. Implement in `src/plugin.ts`.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/oxfmt
bun run test
bun run build
```
