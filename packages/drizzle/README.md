# @nx-devkit/drizzle

Standalone Nx plugin: any `drizzle.config.*` becomes a set of `db:*` targets on the owning project — `db:generate`, `db:migrate`, `db:push`, `db:studio`, `db:check`. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/drizzle drizzle-kit
```

Depends on `@nx/devkit` `^24`. Requires `drizzle-kit` `^0.31` as a peer.

## Register

```bash
nx add @nx-devkit/drizzle   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/drizzle"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                                  | Target        | Command                    | Cacheable | Outputs                    |
| ---------------------------------------- | ------------- | -------------------------- | --------- | -------------------------- |
| `drizzle.config.{ts,js,mts,mjs,cjs,cts}` | `db:generate` | `npx drizzle-kit generate` | yes       | `drizzle/` (default `out`) |
| same                                     | `db:check`    | `npx drizzle-kit check`    | yes       | —                          |
| same                                     | `db:migrate`  | `npx drizzle-kit migrate`  | no        | —                          |
| same                                     | `db:push`     | `npx drizzle-kit push`     | no        | —                          |
| same                                     | `db:studio`   | `npx drizzle-kit studio`   | no        | —                          |

Drizzle Kit auto-discovers its config from the working directory, so the plugin never passes `--config`. Multiple configs in one directory merge into a single target set. `db:migrate` runs `db:check` first (`dependsOn`) so the migrations folder is validated before it is applied.

## Credentials stay in the environment

Connection strings (`DATABASE_URL` and friends) are never interpolated into target commands or argv. `nx:run-commands` inherits `process.env`, so read credentials in `drizzle.config.ts` from `process.env` — e.g. `dbCredentials: { url: process.env.DATABASE_URL! }` — or load a `.env` file in the config.

## Inspect

```bash
npx nx show project my-db                      # see inferred targets
npx nx run my-db:db:generate                   # emit migrations (cached)
npx nx run-many -t db:generate                 # across every package
npx nx run my-db:db:migrate                    # apply migrations (db:check runs first)
npx nx run my-db:db:studio                     # browse the DB
```
