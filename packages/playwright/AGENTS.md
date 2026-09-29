# @nx-devkit/playwright

Agent guide for working in `packages/playwright/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/playwright/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — playwright.config.* → e2e targets
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Invariants

- Trigger glob is `**/playwright.config.{ts,js,mts,mjs,cjs,cts}` only — playwright does not support a package.json key.
- Configs group by owning directory; one `e2e`/`e2e:ui`/`e2e:update-snapshots` set per directory, lexically-first config wins.
- Command is bare `npx playwright test` — playwright auto-discovers its config from `cwd`; never pass `--config`.
- `cwd` is `{projectRoot}`; inputs cover `{projectRoot}/**/*` (app rebuilds must bust the e2e cache) plus every playwright.config in the dir.
- Cached outputs: `test-results/`, `playwright-report/`, `blob-report/` under `{projectRoot}`.
- `e2e:ui` and `e2e:update-snapshots` are never cached; `extraTargets: false` suppresses both.
- `node_modules` and `..`-escaping directories are skipped; output is deterministic (sorted).
- Browser binaries are a consumer step (`npx playwright install`) — never part of the target.

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
```
