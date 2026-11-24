# @nx-devkit/prisma

Agent guide for working in `packages/prisma/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/prisma/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — schema.prisma / prisma.config.* → db:* targets
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxPrismaPluginOptions {
  targetPrefix?: string; // default "db" → db:generate, db:migrate, …
  studio?: boolean; // default true — infer <prefix>:studio
}
```

## Invariants

- Trigger glob is `**/{schema.prisma,prisma.config.*}` — matched files group by owning project root, one target set per project.
- `…/prisma/schema.prisma` maps to the parent dir (standard layout) unless the `prisma` dir has its own `package.json` and the parent does not (project literally named `prisma`).
- `prisma.config.*` (a supported extension: `.ts/.js/.mts/.mjs/.cts/.cjs`) wins over `schema.prisma` in the same project — it declares the schema itself, so commands get no `--schema` flag. Otherwise `--schema '<path rel to projectRoot>'` (shell-quoted; unquotable paths warn + skip) is appended to every command except `db seed`. An unsupported `prisma.config.*` match (e.g. `.bak`) is never treated as a schema — a group with neither yields no targets.
- Only `db:generate` can be `cache: true`, and only for `schema.prisma`-driven projects whose generator `output` dirs resolve statically inside the workspace (they are appended to `outputs`; `env("…")` or an outside-workspace `output` disables caching). `prisma.config.*` projects are never cached — the config's import closure is not an input. Lockfiles (`bun.lock*`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) are inputs. `db:migrate`, `db:migrate-deploy`, `db:studio`, `db:seed` are never cached.
- `db:migrate-deploy` and `db:seed` `dependsOn` `<prefix>:generate`.
- `db:seed` is inferred only when `package.json#prisma.seed` is a non-empty string OR a `prisma.config.*` in the project mentions `seed:`.
- Secrets travel via env only — never interpolate `DATABASE_URL` into a command string.
- `node_modules` and `..`-escaping roots are skipped; the workspace-root project IS supported (`{workspaceRoot}` tokens).
- `jsonc-parser` must stay a dependency — `@nx-devkit/internal` is bundled into the generator chunk and imports it (same fix as `a90b406`).

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
```
