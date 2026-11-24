# @nx-devkit/dotenv

Agent guide for working in `packages/dotenv/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/dotenv/
├── package.json
├── generators.json         # init generator manifest
├── executors.json          # check executor manifest
├── tsdown.config.ts        # entries: plugin, index, executors/check/executor, generators/init/generator
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — .env.example/.env.sample → env:check
│   ├── plugin.spec.ts
│   ├── dotenv.ts           # parseDotenvKeys — key extraction, never values
│   ├── dotenv.spec.ts
│   ├── types.ts            # NxDevkitDotenvOptions
│   ├── index.ts            # public surface
│   ├── executors/check/    # bundled checker: executor.ts + schema.json + spec
│   └── generators/init/    # register plugin (no peer deps)
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitDotenvOptions {
  targetName?: string; // default "env:check"
  envFile?: string; // workspace-relative env file checked instead of each example's `.env` sibling
}
```

## Invariants

- Trigger glob is `**/{.env.example,.env.sample}` only — real `.env` files never trigger projects.
- Matched files group by owning directory; one `env:check` per directory, all example files of the dir verified in a single run.
- `env:check` is `cache: true`; inputs are the example files, the env file the check reads (the sibling `.env`, or the configured `envFile`), and `{ env: KEY }` for every declared key — env changes bust the cache.
- The check runs in the bundled `@nx-devkit/dotenv:check` executor — no external tool, no peer dependency to install.
- **Values never leave the files** — the parser extracts key names only; failure output lists missing names; nothing secret reaches argv, target options, or the report.
- A missing example file fails loud (never a silent pass); a missing `.env` is fine — `process.env` may carry everything (CI).
- `node_modules` and `..`-escaping directories are skipped; output ordering is deterministic.
- `jsonc-parser` must stay a dependency — `@nx-devkit/internal` is bundled into the generator chunk and imports it (same fix as `a90b406`).

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
npx tsc --noEmit -p tsconfig.json   # tsdown does not typecheck
```
