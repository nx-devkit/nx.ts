# @nx-devkit/skillspector

Agent guide for working in `packages/skillspector/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```
packages/skillspector/
├── package.json
├── executors.json
├── tsdown.config.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── index.ts                          # public surface
│   ├── plugin.ts                         # createNodesV2 — SKILL.md → scan target
│   ├── plugin.spec.ts
│   └── executors/
│       └── scan/
│           ├── executor.ts               # scan executor (spawns skillspector)
│           ├── executor.spec.ts
│           └── schema.json
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxDevkitSkillspectorOptions {
  scanTargetName?: string;    // default "scan"
  noLlm?: boolean;            // default true
  annotations?: boolean;      // default true
  failOnError?: boolean;      // default true
  skillspectorBin?: string;   // default "skillspector"
  sarif?: string;             // SARIF output path prefix
  baseline?: string;          // baseline file path
}
```

## Scope rules

- Touch ONLY `packages/skillspector/`.
- Do NOT modify other plugin packages or the root `nx.json`.
- The plugin must skip the workspace root and `node_modules`.
- Use `shouldSkipPath` pattern (skip workspace root, node_modules, path traversal).
- Use `createHash` from `node:crypto` for injective naming (same as @nx-devkit/skill).
- The scan executor must use `execFile` without `shell: true`.
- Annotation escaping is security-critical: encode `%` as `%25`, newlines as `\n`/`\r`, remove `::` delimiters.

## TDD workflow

1. Write failing `src/plugin.spec.ts` and `src/executors/scan/executor.spec.ts` using memfs and `vi.mock('node:child_process')`.
2. `bun test` → RED.
3. Implement `src/plugin.ts` and `src/executors/scan/executor.ts` to pass.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/skillspector
bun test
bun run build
```
