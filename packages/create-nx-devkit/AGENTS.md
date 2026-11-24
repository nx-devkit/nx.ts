# @nx-devkit/create (`npm create @nx-devkit`)

Agent guide for working in `packages/create-nx-devkit/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/create-nx-devkit/
├── package.json          # name: @nx-devkit/create — required for `npm create @nx-devkit`
├── tsdown.config.ts      # entry: src/cli.ts → dist/cli.mjs (bin)
├── vitest.config.ts
├── src/
│   ├── cli.ts            # thin launcher: parse args → detect PM → install → nx g → fixups → summary
│   └── cli.spec.ts
├── README.md
└── AGENTS.md
```

## What it is

A thin launcher, not a plugin. `npm create @nx-devkit` resolves to package `@nx-devkit/create`;
its bin runs `nx g @nx-devkit/typescript:monorepo` in the target dir. All scaffolding logic
lives in the generator — never duplicate it here.

## Key behaviors

- **PM detection**: `--pm` flag → `npm_config_user_agent` (the invoking PM) → lockfiles in the
  target dir → npm. Install and `nx` invocation are dispatched per PM.
- **Bootstrap deps**: `nx@^24.0.0`, `@nx/devkit@^24.0.0`, `@nx-devkit/typescript` installed as
  devDeps in the target dir before generating.
- **Modes**: `create @nx-devkit <name>` creates `./<name>`; `create @nx-devkit .` (or `--dir`)
  scaffolds into an existing repo — a stub `package.json` is written only when missing.
- **`applyWorkspaceFixups`**: compat patches for published-generator output. Each fixup is
  documented inline and must be removed once the generator stops emitting the broken output:
  1. `nx.includedScripts: []` on the generated package when its scripts call back into `nx`
     (run-script inference shadows inferred targets → recursion).
  2. strip `baseUrl` from generated `tsconfig.base.json` (removed in TS6/7) and relativize `paths`.

## Scope rules

- Touch ONLY `packages/create-nx-devkit/`.
- Do NOT modify other packages or the root `nx.json`.
- Generator fixes belong in `packages/typescript-preset/` (a different bead).

## TDD workflow

1. Write failing `src/*.spec.ts` (vitest). Mock `node:child_process` (`execFileSync`);
   use real `mkdtempSync` for fs.
2. `bun run test` → RED.
3. Implement the minimum to pass.
4. `bun run build`.

## Verification commands

```bash
cd packages/create-nx-devkit
bun run test
bun run build
```

End-to-end smoke: `node dist/cli.mjs my-workspace --pm bun` in a temp dir, then
`nx run-many -t typecheck,test,lint,build` inside the scaffolded workspace.
