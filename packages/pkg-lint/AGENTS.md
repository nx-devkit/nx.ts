# @nx-devkit/pkg-lint

Agent guide for working in `packages/pkg-lint/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/pkg-lint/
├── package.json
├── tsdown.config.ts        # entry: plugin.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — publishable package.json → `lint-pkg`
│   └── plugin.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxPkgLintPluginOptions {
  /** Name of the inferred target. Default: "lint-pkg". */
  targetName?: string;
  /** Run `npx publint` as part of the target. Default: true. */
  publint?: boolean;
  /** Run `npx attw --pack` as part of the target. Default: true. */
  attw?: boolean;
}
```

## Invariants

- Trigger glob is `**/package.json`; a manifest infers `lint-pkg` only when it is publishable: `exports`, `bin`, or `main` + `files`, and `private !== true` (same signal the typescript preset uses for `build`, plus the private veto).
- The target runs `npx publint` then `npx attw --pack` sequentially (`parallel: false`) with `cwd: '{projectRoot}'`.
- `attw --pack` packs the real tarball, so the target is `dependsOn: ['build']` and its cached inputs are `package.json` + `dist/**/*` (`{workspaceRoot}` prefix for the root project, `{projectRoot}` otherwise).
- Disabling both tools (`publint: false` + `attw: false`) infers nothing.
- `node_modules` and `..`-escaping directories are skipped; output is deterministic (sorted).

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
```
