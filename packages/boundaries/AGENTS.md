# @nx-devkit/boundaries

Agent guide for working in `packages/boundaries/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/boundaries/
├── package.json
├── tsdown.config.ts          # entries: index, plugin, executors/check-boundaries/executor
├── vitest.config.ts
├── tsconfig.json
├── executors.json
├── src/
│   ├── index.ts              # public surface
│   ├── types.ts              # DepConstraint, TagInference, NxBoundariesOptions
│   ├── plugin.ts             # createNodesV2 — `**/package.json` → per-project + root check-boundaries
│   ├── plugin.spec.ts
│   ├── tags.ts               # effective tags (explicit nx.tags win; else dir/type inference) + index (+ tags.spec.ts)
│   ├── imports.ts            # TS-parser import scanning (+ imports.spec.ts)
│   ├── resolve.ts            # specifier → project / external package name (+ resolve.spec.ts)
│   ├── constraints.ts        # depConstraints + external-deps evaluation (+ constraints.spec.ts)
│   ├── cycles.ts             # Tarjan SCC circular-dependency detection (+ cycles.spec.ts)
│   ├── report.ts             # BoundaryViolation + text/json/mermaid renderers (+ report.spec.ts)
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
  depConstraints?: DepConstraint[]; // sourceTag + onlyDependOnLibsWithTags? + notDependOnLibsWithTags? + allowed/bannedExternalDeps? (+ *Imports aliases)
  targetName?: string; // default "check-boundaries"
  inferTags?: boolean | TagInference; // dir:<seg> + type:* from layout; default true; explicit nx.tags win
  checkCircularDependencies?: boolean; // default true
  format?: 'text' | 'json' | 'mermaid'; // default "text"
}
```

## Scope rules

- Touch ONLY `packages/boundaries/`.
- Do NOT modify other plugin packages or the root `nx.json` — except adding `packages/boundaries` to `release.projects` when the bead covers package onboarding.
- The plugin emits a per-project `check-boundaries` on every project with EFFECTIVE tags (explicit `nx.tags`, else dir/type inference) plus a root aggregate gate. With `inferTags: false` and no `nx.tags` anywhere, nothing is emitted — a vacuous pass is a false green.
- Per-project targets pass `options.project` (project name); the executor scopes edge scans to it and filters cycles to ones containing it.
- Constraint semantics MUST match `@nx/enforce-module-boundaries`: matching sourceTag → target must share ≥1 allowed tag AND no banned tag; `allowedExternalDeps` (when present) is an externals allowlist, `bannedExternalDeps` a denylist; untagged sources permissive; self-imports allowed.
- Circular dependencies come from `graph.dependencies` (implicit deps and non-workspace targets excluded) — one witness path per strongly-connected component.
- Import scanning MUST use the TypeScript parser (`ts.createSourceFile`) — never regexes.
- `typescript` stays on `^5.0.0 || ^6.0.0`: `ts.createSourceFile` needs the JS compiler API, which `typescript@7+` (native) no longer ships. The rest of the workspace builds on the latest TS — do not "fix" this ceiling when bumping TS repo-wide.

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
