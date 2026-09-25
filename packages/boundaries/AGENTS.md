# @nx-devkit/boundaries

Agent guide for working in `packages/boundaries/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```
packages/boundaries/
├── package.json
├── tsdown.config.ts          # entries: index, plugin, executors/check-boundaries/executor
├── vitest.config.ts
├── tsconfig.json
├── executors.json
├── src/
│   ├── index.ts              # public surface
│   ├── types.ts              # DepConstraint, NxBoundariesOptions
│   ├── plugin.ts             # createNodesV2 — `**/package.json` + nx.tags → root check-boundaries
│   ├── plugin.spec.ts
│   ├── tags.ts               # project name → tags / resolution index
│   ├── imports.ts            # TS-parser import scanning (+ imports.spec.ts)
│   ├── resolve.ts            # specifier → project (relative, pkg name, tsconfig paths)
│   ├── constraints.ts        # depConstraints evaluation (+ constraints.spec.ts)
│   └── executors/
│       └── check-boundaries/
│           ├── executor.ts   # graph walk + scan + report
│           ├── executor.spec.ts
│           └── schema.json
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxBoundariesOptions {
  depConstraints?: DepConstraint[];  // [{sourceTag, onlyDependOnLibsWithTags}]
  targetName?: string;               // default "check-boundaries"
}
```

## Scope rules

- Touch ONLY `packages/boundaries/`.
- Do NOT modify other plugin packages or the root `nx.json` — except adding `packages/boundaries` to `release.projects` when the bead covers package onboarding.
- The plugin emits the target ONLY when ≥1 non-root project declares `nx.tags` — a vacuous pass is a false green.
- Constraint semantics MUST match `@nx/enforce-module-boundaries`: matching sourceTag → target must share ≥1 allowed tag; untagged sources permissive; self-imports allowed.
- Import scanning MUST use the TypeScript parser (`ts.createSourceFile`) — never regexes.

## TDD workflow

1. Write failing specs: `plugin.spec.ts` (memfs), `imports.spec.ts`, `constraints.spec.ts` (pure), `executor.spec.ts` (real `mkdtempSync` workspace + hand-built `ProjectGraph` — `fs.globSync` does not work under memfs).
2. `bun run test` → RED.
3. Implement to GREEN.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/boundaries
bun run test
bun run build
```
