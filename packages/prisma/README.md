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
| `schema.prisma` / `prisma.config.*`     | `db:generate`       | `npx prisma generate`       | yes**     |
| same                                    | `db:migrate`        | `npx prisma migrate dev`    | no        |
| same                                    | `db:migrate-deploy` | `npx prisma migrate deploy` | no        |
| same                                    | `db:studio`         | `npx prisma studio`         | no        |
| same + `prisma.seed` in `package.json`* | `db:seed`           | `npx prisma db seed`        | no        |

\* `db:seed` is also inferred when `prisma.config.*` declares a seed (`migrations.seed`).

\*\* `db:generate` caching applies to `schema.prisma`-driven projects only — see below.

- `cwd` is `{projectRoot}`. With `schema.prisma`, the Prisma CLI loads the project `.env` itself; `prisma.config.*` does **not** auto-load `.env` — export the variables or load `dotenv` inside the config file, otherwise `DATABASE_URL` can be missing.
- A `schema.prisma` or `prisma.config.*` inside a `prisma/` subdirectory maps to the parent project (`apps/api/prisma/schema.prisma` → `apps/api`) — unless that `prisma/` directory has its own `package.json` while the parent does not, in which case it is its own project. The `--schema` flag carries the schema's path relative to the project (shell-quoted); `prisma.config.*` declares the schema itself, so no `--schema` is passed.
- `db:migrate-deploy` and `db:seed` `dependsOn` `db:generate`, so the client is fresh before a deploy or a seed.
- `db:generate` is the only cacheable target. Its declared outputs are the default client locations (`node_modules/.prisma`, `node_modules/@prisma/client`) plus any custom `generator … { output = "…" }` directories parsed from the schema. Dependency lockfiles are inputs, so a prisma version bump busts the cache. A `prisma.config.*` project is never cached — its import closure cannot be hashed — and neither is a schema whose `output` is not statically resolvable (e.g. `env("…")`) or points outside the workspace.

## Secrets

`DATABASE_URL` and friends reach prisma through process env (`nx:run-commands` inherits the environment, and with `schema.prisma` the CLI loads `.env` from `cwd` itself). Connection strings are never interpolated into the command line — nothing secret ever lands in `argv`, the terminal log, or the Nx cache.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/prisma",
      "options": {
        "targetPrefix": "prisma", // rename the target set → prisma:generate etc.
        "studio": false, // skip prisma:studio (default: true)
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
