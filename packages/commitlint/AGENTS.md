# @nx-devkit/commitlint

Agent guide for working in `packages/commitlint/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/commitlint/
├── package.json
├── tsdown.config.ts        # entry: plugin, generators/init/generator
├── vitest.config.ts
├── tsconfig.json
├── generators.json
├── src/
│   ├── plugin.ts           # createNodesV2 — commitlint configs → `commitlint` target
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxCommitlintPluginOptions {
  targetName?: string  // default "commitlint"
  args?: string        // default "--last"
}
```

## Scope rules

- Touch ONLY `packages/commitlint/`.
- Do NOT modify other plugin packages or the root `nx.json` — except adding `packages/commitlint` to `release.projects` when the bead covers package onboarding.

## Invariants

- Discovery mirrors cosmiconfig's `commitlint` search order: `package.json` key → `.commitlintrc*` → `commitlint.config.*`; first match in a directory wins.
- The inferred target MUST be `cache: false` — the verdict depends on git history, not file inputs.
- `cwd` is `{projectRoot}` so commitlint auto-discovers the owning directory's config.

## TDD workflow

1. Write failing specs in `plugin.spec.ts` (memfs/tmp dirs via `mkdtempSync`).
2. `bun run test` → RED.
3. Implement to GREEN.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/commitlint
bun run test
bun run build
```
