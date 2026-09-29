# @nx-devkit/cspell

Agent guide for working in `packages/cspell/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/cspell/
├── package.json
├── tsdown.config.ts        # entry: plugin, generators/init/generator
├── vitest.config.ts
├── tsconfig.json
├── generators.json
├── src/
│   ├── plugin.ts           # createNodesV2 — cspell configs → `spell` target
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxCspellPluginOptions {
  targetName?: string  // default "spell"
  args?: string        // default "."
}
```

## Scope rules

- Touch ONLY `packages/cspell/`.
- Do NOT modify other plugin packages or the root `nx.json` — except adding `packages/cspell` to `release.projects` when the bead covers package onboarding.

## Invariants

- Discovery mirrors cspell's search order: `package.json` key → `cspell.json`/`cspell.config.*` → yaml forms; first match in a directory wins.
- The inferred target MUST be `cache: true` — the verdict depends on file contents only.
- `cwd` is `{projectRoot}` so cspell auto-discovers the owning directory's config.

## TDD workflow

1. Write failing specs in `plugin.spec.ts` (memfs/tmp dirs via `mkdtempSync`).
2. `bun run test` → RED.
3. Implement to GREEN.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/cspell
bun run test
bun run build
```
