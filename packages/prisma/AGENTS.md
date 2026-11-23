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
- `prisma.config.*` wins over `schema.prisma` in the same project — it declares the schema itself, so commands get no `--schema` flag. Otherwise `--schema <path rel to projectRoot>` is appended to every command except `db seed`.
- Only `db:generate` is `cache: true` (deterministic per schema); `db:migrate`, `db:migrate-deploy`, `db:studio`, `db:seed` are never cached.
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
