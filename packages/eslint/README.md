# @nx-devkit/eslint

Standalone Nx plugin: any `eslint.config.*` (flat config) becomes a cached `lint` target (plus `lint:fix`) on the owning project. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

> The [@nx-devkit/typescript](https://www.npmjs.com/package/@nx-devkit/typescript) preset already covers ESLint as a lint fallback. Use this standalone package when ESLint is your only tool — or when you want the `lint` target without registering the preset.

## Install

```bash
bun add -D @nx-devkit/eslint eslint
```

Depends on `@nx/devkit` `^22 || ^23`. Requires `eslint` `^9` (flat config) as a peer — legacy `.eslintrc.*` is not detected.

## Register

```bash
nx add @nx-devkit/eslint   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/eslint"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger | Target | Command | Cacheable | Inputs |
|---|---|---|---|---|
| `eslint.config.{js,mjs,cjs,ts,mts,cts}` | `lint` | `npx eslint .` (cwd = `{projectRoot}`) | yes | `<root>/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}` + config files |
| same | `lint:fix` | `npx eslint . --fix` | no | — |

ESLint auto-discovers `eslint.config.*` from the working directory. Multiple configs in one directory merge into a single target pair; every config file is a target input so edits bust the cache.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/eslint",
      "options": {
        "targetName": "lint",  // rename the target pair
        "fixTarget": false      // do not infer `lint:fix` (default: true)
      }
    }
  ]
}
```

## Inspect

```bash
npx nx show project my-app     # see inferred targets
npx nx run my-app:lint         # lint (cached)
npx nx affected -t lint        # CI: only affected projects
npx nx run my-app:lint:fix     # autofix
```
