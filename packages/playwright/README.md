# @nx-devkit/playwright

Standalone Nx plugin: any `playwright.config.*` becomes a cached `e2e` target (plus `e2e:ui` and `e2e:update-snapshots`) on the owning project. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/playwright @playwright/test
```

Depends on `@nx/devkit` `^22 || ^23`. Requires `@playwright/test` `^1.40` as a peer. Browsers are installed separately — `npx playwright install` is a one-time consumer step, not part of the target.

## Register

```bash
nx add @nx-devkit/playwright   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/playwright"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger | Target | Command | Cacheable | Outputs |
|---|---|---|---|---|
| `playwright.config.{ts,js,mts,mjs,cjs,cts}` | `e2e` | `npx playwright test` (cwd = `{projectRoot}`) | yes | `test-results/`, `playwright-report/`, `blob-report/` |
| same | `e2e:ui` | `npx playwright test --ui` | no | — |
| same | `e2e:update-snapshots` | `npx playwright test --update-snapshots` | no | — |

Playwright auto-discovers its config from the working directory, so the plugin never passes `--config`. Multiple configs in one directory merge into a single target set. Inputs cover the whole project tree — an app rebuild busts the e2e cache, which is what you want.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/playwright",
      "options": {
        "targetName": "e2e",        // rename the target set
        "extraTargets": false        // skip e2e:ui / e2e:update-snapshots (default: true)
      }
    }
  ]
}
```

## Inspect

```bash
npx nx show project my-app                    # see inferred targets
npx nx run my-app:e2e                         # run browser tests (cached)
npx nx affected -t e2e                        # CI: only affected projects
npx nx run my-app:e2e:update-snapshots        # refresh snapshots
```
