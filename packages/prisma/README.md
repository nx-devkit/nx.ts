# @nx-devkit/prisma

Standalone Nx plugin: any `schema.prisma` or `prisma.config.*` becomes a set of `db:*` targets on the owning project. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/prisma prisma
```

Depends on `@nx/devkit` `^24`. Requires `prisma` `^6 || ^7` as a peer.

## Register

```bash
nx add @nx-devkit/prisma   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/prisma"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                                 | Target              | Command                     | Cacheable |
| --------------------------------------- | ------------------- | --------------------------- | --------- |
| `schema.prisma` / `prisma.config.*`     | `db:generate`       | `npx prisma generate`       | yes       |
| same                                    | `db:migrate`        | `npx prisma migrate dev`    | no        |
| same                                    | `db:migrate-deploy` | `npx prisma migrate deploy` | no        |
| same                                    | `db:studio`         | `npx prisma studio`         | no        |
| same + `prisma.seed` in `package.json`* | `db:seed`           | `npx prisma db seed`        | no        |

\* `db:seed` is also inferred when `prisma.config.*` declares a seed (`migrations.seed`).

- `cwd` is `{projectRoot}` so prisma picks up the project `.env`.
- A `schema.prisma` inside a `prisma/` subdirectory maps to the parent project (`apps/api/prisma/schema.prisma` → `apps/api`); the `--schema` flag carries the relative path. A `prisma.config.*` owns its directory and declares the schema itself, so no `--schema` is passed.
- `db:migrate-deploy` and `db:seed` `dependsOn` `db:generate`, so the client is fresh before a deploy or a seed.
- `db:generate` is the only cached target — deterministic for a given schema. Its declared outputs are the default client locations (`node_modules/.prisma`, `node_modules/@prisma/client`); a custom `output` in the generator block is not captured.

## Secrets

`DATABASE_URL` and friends reach prisma through process env (`nx:run-commands` inherits the environment, and prisma loads `.env` from `cwd` itself). Connection strings are never interpolated into the command line — nothing secret ever lands in `argv`, the terminal log, or the Nx cache.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/prisma",
      "options": {
        "targetPrefix": "db", // rename the target set → prisma:* etc.
        "studio": false, // skip db:studio (default: true)
      },
    },
  ],
}
```

## Inspect

```bash
npx nx show project my-api            # see inferred targets
npx nx run-many -t db:generate        # generate every client in the workspace
```
