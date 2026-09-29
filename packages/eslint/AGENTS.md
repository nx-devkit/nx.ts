# @nx-devkit/eslint

Agent guide for working in `packages/eslint/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/eslint/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — eslint.config.* → lint/lint:fix
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Invariants

- Trigger glob is `**/eslint.config.{js,mjs,cjs,ts,mts,cts}` — flat config only; legacy `.eslintrc.*` is intentionally out of scope (eslint >=9 default).
- Configs group by owning directory; one `lint`/`lint:fix` pair per directory, lexically-first config wins.
- Command is bare `npx eslint .` — eslint auto-discovers its config from `cwd`; never pass `--config`.
- `cwd` is `{projectRoot}`; inputs cover source extensions plus every eslint.config in the dir.
- `lint:fix` (`npx eslint . --fix`) is never cached; `fixTarget: false` suppresses it.
- `node_modules` and `..`-escaping directories are skipped; output is deterministic (sorted).

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
```
