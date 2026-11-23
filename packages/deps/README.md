# @nx-devkit/deps

Standalone Nx plugin: a syncpack config (or a workspaces-root `package.json` using manypkg) becomes a cached `deps:check` target — plus an opt-in `deps:fix` — on the owning project. Dependency version drift and duplicated ranges, caught per project and cached by Nx. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/deps syncpack          # or: bun add -D @nx-devkit/deps @manypkg/cli
```

Depends on `@nx/devkit` `^24`. Requires `syncpack` `^15` or `@manypkg/cli` `^0.25` as optional peers (at least one).

## Register

```bash
nx add @nx-devkit/deps   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/deps"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                                                                                                                                   | Backend  | Target       | Command                                     | Cacheable |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ | ------------------------------------------- | --------- |
| `syncpack.config.{js,cjs,mjs,ts}`, `.syncpackrc` / `.syncpackrc.{json,yaml,yml,js,cjs,mjs,ts}`, or `package.json` with a `"syncpack"` key | syncpack | `deps:check` | `npx syncpack lint` (cwd = `{projectRoot}`) | yes       |
| either of the above (syncpack)                                                                                                            | syncpack | `deps:fix`   | `npx syncpack fix`                          | no        |
| root `package.json` with `workspaces` + `@manypkg/cli`/`manypkg` in deps/devDeps/peerDeps                                                 | manypkg  | `deps:check` | `npx manypkg check`                         | yes       |

Rules of precedence: a directory with any syncpack signal gets the syncpack pair — manypkg is only a fallback when no syncpack config exists. The manypkg fallback applies to the **workspace root `package.json` only**; nested manifests never infer manypkg targets. Report-only by default: `deps:check` is cached (its verdict depends only on `package.json` manifests, the lockfile, and the syncpack config); `deps:fix` mutates manifests and is never cached.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/deps",
      "options": {
        "checkTargetName": "deps:check", // rename the check target
        "fixTargetName": "deps:fix", // rename the fix target
        "fixTarget": false, // do not infer `deps:fix` (default: true)
      },
    },
  ],
}
```

## Inspect

```bash
npx nx show project my-workspace          # see inferred targets
npx nx run my-workspace:deps:check        # report consistency violations
npx nx run my-workspace:deps:fix          # align drifting versions (syncpack)
```
