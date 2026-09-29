# @nx-devkit/knip

Standalone Nx plugin: any `knip` config file — or a `package.json` carrying a `"knip"` key — becomes a cached `knip` target (plus `knip:fix`) on the owning project. Dead exports, unused files and unused dependencies, detected per project and cached by Nx. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/knip knip
```

Depends on `@nx/devkit` `^22 || ^23`. Requires `knip` `^5 || ^6` as a peer.

## Register

```bash
nx add @nx-devkit/knip   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/knip"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger | Target | Command | Cacheable | Inputs |
|---|---|---|---|---|
| `knip.{json,jsonc,ts}`, `knip.config.{ts,js,mjs,cjs}`, or `package.json` with a `"knip"` key | `knip` | `npx knip` (cwd = `{projectRoot}`) | yes | `<root>/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,json,jsonc}` + the config files |
| either of the above | `knip:fix` | `npx knip --fix` | no | — |

Knip auto-discovers its config from the working directory, so the plugin never passes `--config` — the target simply runs `knip` in the directory that owns the config. When several config forms live in one directory they merge into a single target pair (`knip.json` wins, matching knip's own discovery order). A `package.json` *without* a `"knip"` key infers nothing — it is only scanned as a possible config host.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/knip",
      "options": {
        "targetName": "knip",   // rename the target
        "fixTarget": false       // do not infer `knip:fix` (default: true)
      }
    }
  ]
}
```

## Inspect

```bash
npx nx show project my-app          # see inferred targets
npx nx run my-app:knip              # analyze
npx nx run my-app:knip:fix          # auto-remove unused exports/deps
```

CI tip: run `npx nx affected -t knip` to analyze only the projects touched by a change.
