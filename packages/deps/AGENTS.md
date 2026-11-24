# @nx-devkit/deps

Agent guide for working in `packages/deps/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/deps/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — syncpack/manypkg configs → deps:check/deps:fix
│   ├── plugin.spec.ts      # inference unit tests
│   ├── e2e.spec.ts         # real-CLI acceptance: syncpack lint/fix + manypkg check on tmp fixture
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxDepsPluginOptions {
  checkTargetName?: string; // default "deps:check"
  fixTargetName?: string; // default "deps:fix"
  fixTarget?: boolean; // default true (syncpack only)
}
```

## Invariants

- Trigger glob covers exactly: `syncpack.config.{js,cjs,mjs,ts}`, `.syncpackrc`, `.syncpackrc.{json,yaml,yml,js,cjs,mjs,ts}`, `.manypkg.json`, `package.json`, and the manypkg root markers (`bun.lock`, `bun.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-workspace.yaml`, `lerna.json`, `rush.json`). A `package.json` is a syncpack host when it has a `"syncpack"` key, otherwise it is a manypkg host only at the workspace root (`workspaces` + `@manypkg/cli`/`manypkg` dep + a root marker — without one, `manypkg check` cannot resolve the workspace).
- Syncpack always wins over manypkg in the same directory — manypkg is a fallback, never additive.
- Commands: `npx syncpack lint` (check), `npx syncpack fix` (fix), `npx manypkg check` (fallback check). `cwd` is `{projectRoot}`; both tools auto-discover their config/workspace.
- `deps:check` is `cache: true` — verdict depends only on `{prefix}/**/package.json`, workspace-root lockfiles, and the config files in the dir (all listed as inputs). Root markers gate inference only; they are not per-target inputs (lockfile inputs already cover them).
- `deps:fix` is `cache: false` and never inferred for manypkg.
- `node_modules` and `..`-escaping directories are skipped (`shouldSkipDir`); output ordering is deterministic.

## Commands

```bash
bun run test        # vitest — includes real-CLI e2e (syncpack/@manypkg/cli are devDeps)
bun run build       # tsdown → dist/*.mjs + *.d.mts
```
