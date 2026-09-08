# @nx-devkit/skill

Agent guide for working in `packages/skill/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```
packages/skill/
├── package.json
├── tsdown.config.ts          # entry: src/index.ts, src/plugin.ts
├── vitest.config.ts
├── tsconfig.json
├── executors.json            # registers the build executor
├── src/
│   ├── index.ts              # re-exports createNodesV2 + build executor
│   ├── plugin.ts             # createNodesV2 — `**/SKILL.md` → 5 targets
│   ├── plugin.spec.ts
│   └── executors/
│       └── build/
│           ├── executor.ts   # skills-compiler wrapper (execFile, no shell)
│           ├── executor.spec.ts
│           └── schema.json
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxDevkitSkillOptions {
  buildTargetName?: string;    // default "build"
  lintTargetName?: string;     // default "lint"
  validateTargetName?: string; // default "validate"
  osCheckTargetName?: string;  // default "os-check"
  sizeCheckTargetName?: string;// default "size-check"
  skillInputs?: string[];      // additional input globs for build
}
```

## Scope rules

- Touch ONLY `packages/skill/`.
- Do NOT modify other plugin packages or the root `nx.json`.
- The plugin MUST skip the workspace root and `node_modules`.
- Use `shouldSkipPath` pattern from `typescript-preset`.
- Use `createHash` from `node:crypto` for injective naming — never rely on slug alone.
- The build executor MUST use `execFile` without `shell: true`.
- Do NOT interpolate `projectRoot` into shell commands — use the `{projectRoot}` Nx macro in inputs (Nx expands it safely).

## TDD workflow

1. Write a failing `src/plugin.spec.ts` and `src/executors/build/executor.spec.ts` covering: project inference, injective naming, skip rules, all 5 targets, custom target names, executor success/failure.
2. `bun test` → RED.
3. Update `src/plugin.ts` and `src/executors/build/executor.ts` until tests pass.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/skill
bun test
bun run build
```
