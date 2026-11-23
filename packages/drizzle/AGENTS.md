# @nx-devkit/drizzle

Agent guide for working in `packages/drizzle/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/drizzle/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — drizzle.config.* → db:* targets
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Invariants

- Trigger glob is `**/drizzle.config.{ts,js,mts,mjs,cjs,cts}` only.
- Configs group by owning directory; one `db:generate`/`db:check`/`db:migrate`/`db:push`/`db:studio` set per directory, lexically-first config wins.
- Command is `npx drizzle-kit <sub>` — drizzle-kit auto-discovers its config from `cwd`; never pass `--config`.
- `cwd` is `{projectRoot}`; inputs cover `{projectRoot}/**/*` plus every drizzle.config in the dir.
- `db:generate` and `db:check` are cached; `db:generate` outputs `{projectRoot}/drizzle` (the default `out:`). `db:migrate`, `db:push`, `db:studio` are never cached.
- `db:migrate` has `dependsOn: ['db:check']` — validate the migrations folder before applying it.
- **Credentials never reach argv.** No `DATABASE_URL`, no connection strings, no `--url` flags — drizzle-kit reads env itself and `nx:run-commands` inherits `process.env`.
- `node_modules` and `..`-escaping directories are skipped; output is deterministic (sorted).

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
```
