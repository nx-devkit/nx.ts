# @nx-devkit/pkg-lint

Standalone Nx plugin: every publishable `package.json` (`exports` / `bin`, or `main` + `files`) infers a cached `lint-pkg` target that runs `publint` and `attw --pack` — the two checks that catch the most packaging bugs. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/pkg-lint publint @arethetypeswrong/cli
```

Depends on `@nx/devkit` `^24`. `publint` and `@arethetypeswrong/cli` are optional peers — install only the tools you keep enabled.

## Register

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/pkg-lint"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                                        | Target     | Command                                        | Cacheable | Inputs                                      | Depends on |
| ---------------------------------------------- | ---------- | ---------------------------------------------- | --------- | ------------------------------------------- | ---------- |
| publishable `package.json` (any project depth) | `lint-pkg` | `npx publint` + `npx attw --pack` (sequential) | yes       | `package.json` + `dist/**/*` of the project | `build`    |

Publishable means the manifest has `exports`, `bin`, or `main` + `files` — the same signal the typescript preset uses to infer `build`. `private: true` manifests infer nothing. `attw --pack` packs the real tarball, so the target runs after `build` and its cache key includes `dist` outputs.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/pkg-lint",
      "options": {
        "targetName": "lint-pkg", // rename the target
        "publint": false, // drop `npx publint` from the command list (default: true)
        "attw": false, // drop `npx attw --pack` from the command list (default: true)
      },
    },
  ],
}
```

Disabling both tools infers no target at all.

## Inspect

```bash
npx nx show project my-lib          # see inferred targets
npx nx run my-lib:lint-pkg          # lint the package manifest + packed types
```

CI tip: run `npx nx affected -t lint-pkg` to check only the packages touched by a change.
