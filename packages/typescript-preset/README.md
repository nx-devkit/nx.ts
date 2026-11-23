# @nx-devkit/typescript

The nx-devkit preset plugin: one entry in `nx.json` gives every project `typecheck`, `test`, `lint`, `format`, and `build` targets inferred from the config files it already has — `tsconfig.json`, `vitest.config.*`, `.oxlintrc.*`, `eslint.config.*`, `biome.json{,c}`, `.oxfmtrc.json{,c}`/`oxfmt.config.{ts,mts}`, `tsdown.config.*`. No `project.json` anywhere.

## Install

### One-command bootstrap (recommended)

```bash
npx @nx-devkit/typescript init
```

This:

1. Installs `@nx-devkit/typescript` (plus `nx`/`@nx/devkit` when missing) into the workspace — the plugin is fetched from the npx cache to a real devDependency
2. Registers `@nx-devkit/typescript` in `nx.json` — removing standalone `@nx-devkit/*` entries, preserving your existing preset options and non-nx-devkit plugins
3. Detects config files at the workspace root and in `packages/`, `apps/`, `libs/`, `projects/` (nested project roots are found recursively)
4. Adds devDependencies for the tools your configs imply (`typescript`, `@typescript/native`, `vitest`, `oxlint`, `eslint`, `@biomejs/biome`, `oxfmt`, `tsdown`)
5. Prints the detected projects and the targets each will get

If the workspace has no Nx yet, the bootstrap installs `nx` + `@nx/devkit` first.

#### First-install warnings you may see

- **`npm audit`: 2 high severity vulnerabilities** — these come from
  `nx` itself, not from this plugin: `nx@23.2.x` exact-pins
  `smol-toml@1.6.1`, which is affected by
  [GHSA-7w5x-hrqm-74c2](https://github.com/advisories/GHSA-7w5x-hrqm-74c2)
  (DoS via malformed TOML). Fixed upstream in nrwl/nx#37059 — it ships
  with the next Nx release. To lift it today, add
  `"overrides": { "smol-toml": "^1.7.1" }` to your root `package.json`
  and re-run `npm install` — the audit warning persists until the tree
  is re-resolved.
- **`allow-scripts` prompt for `nx` postinstall** — `nx` runs
  `node -e "try{require('./dist/bin/post-install')}catch(e){}"` on install
  (loads Nx's post-install task — platform-support and Nx Cloud checks).
  Verify before approving: `npm view nx scripts`, or inspect
  `node_modules/nx/package.json` → `scripts`. In our tests Nx worked
  without it (`nx show projects` ran fine with the hook blocked), but
  check the exact script in your installed version before skipping.

### Manual setup

```bash
bun add -D @nx-devkit/typescript
```

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/typescript"] }
```

Depends on `@nx/devkit` `^24` (installed automatically); `typescript` is the one required peer. The remaining tools are optional peers — install only what your configs use:

> **Caveat — `typescript@7` at the workspace root:** the native line no longer ships the JS compiler API (`ts.createSourceFile`, `readConfigFile`, …), which `nx@24` needs for its project-graph plugin. Use the Microsoft-recommended side-by-side aliases instead — `"typescript": "npm:@typescript/typescript6@^6"` keeps a TS 6 API for tools while `"@typescript/native": "npm:typescript@^7"` supplies the native `tsc` for real typecheck/build. A direct `typescript@7` devDep breaks `nx` on `nx@24`.

```bash
bun add -D vitest oxlint eslint @biomejs/biome oxfmt tsdown
# tsgo (optional, not a declared peer): bun add -D @typescript/native@npm:typescript@^7
```

## What it infers

<!-- target table consistent with src/targets/*.ts and src/plugin.ts skip rules -->

| Config detected                                                    | Targets                                                            | Runs                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tsconfig.json` (or `configFile` option)                           | `typecheck`                                                        | `@nx-devkit/typescript:typecheck` executor — `tsc --build` (native under typescript@7) or `tsgo --build`, shell-free, 10-min bounded |
| `vitest.config.*`                                                  | `test`, `test:watch`, `test:coverage`                              | `vitest run` / `vitest` / `vitest run --coverage`                                                                                    |
| `*.test.*`/`*.spec.*` without Vitest                               | `test` (+ `test:tap`, `test:coverage` when enabled)                | native `node --test` (requires Node ≥ 22.18)                                                                                         |
| `testCi` option + test files                                       | `test-ci` + one `test-ci--<file>` per test/spec file               | `nx:noop` group + per-file `vitest run <file>` or `node --test <file>` — atomized for DTE sharding                                   |
| `.oxlintrc.*` + `oxlint: true`                                     | `lint`                                                             | `oxlint .`                                                                                                                           |
| `eslint.config.*` + `eslint: true`                                 | `lint` (if oxlint did not provide it)                              | `eslint .`                                                                                                                           |
| `biome.json{,c}` + `biome: true`                                   | `format`, `format-check` (+ `lint` if no earlier tool provided it) | `biome format --write .` / `biome format .` / `biome lint .`                                                                         |
| `.oxfmtrc.{json,jsonc}` / `oxfmt.config.{ts,mts}` + `oxfmt: true`  | `format`, `format-check` (wins over biome)                         | `oxfmt --write .` / `oxfmt --check .`                                                                                                |
| `tsdown.config.*`                                                  | `build`, `build:watch`                                             | `@nx-devkit/typescript:build` executor — `tsdown` / `tsdown --watch`                                                                 |
| publishable `package.json` + `src/index.ts` (no `tsdown.config.*`) | `build`, `build:watch`                                             | config-free tsdown — same executor; publishable = `exports` or `bin` field, or `main` + `files`                                      |

All `nx:run-commands` targets run with `cwd` = the project root and resolve binaries from `node_modules/.bin`. The executors resolve the tool's Node entry directly and walk up ancestor `node_modules` directories — hoisted monorepo installs work, on Windows too.

Native `test` targets run `node --test` directly on `.ts` test files and require **Node ≥ 22.18** (unflagged type stripping). Node 22.6–22.17 works with `NODE_OPTIONS=--experimental-strip-types`. If vitest is configured (`vitest.config.*`), its targets take priority and no native targets are inferred.

`test:watch` and `build:watch` are marked `continuous` with a `readyWhen` log probe (`Waiting for file changes` / `Build complete`), so dependents can declare them in `dependsOn` and start once the watch process is up. With `testCi` enabled, every detected test/spec file gets its own `test-ci--<file>` target plus a `test-ci` group that `dependsOn` all of them — the same atomization pattern as `@nx/playwright`'s `ciTargetName`, which lets Nx DTE shard individual files across agents. Inferred projects also carry `metadata.technologies` (e.g. `["typescript", "vitest", "tsdown"]`) for `nx graph` / Nx Console.

### Lint precedence

Each lint source requires its option enabled _and_ its config present: oxlint wins when `oxlint: true` and `.oxlintrc.*` exists; eslint wins when `eslint: true` and `eslint.config.*` exists; biome owns `lint` only when `biome: true`, `biome.json{,c}` exists, and no earlier tool provided `lint`. So `oxlint: false` lets ESLint win even with an `.oxlintrc.*` present, and `eslint: true` without an `eslint.config.*` still leaves `lint` for Biome. Biome's `format`/`format-check` are inferred regardless of who owns `lint`. Root-level lint/format configs are used as fallbacks for projects that lack their own.

### Format precedence

The format family follows the same direction as lint — the oxc tool wins: when `oxfmt: true` and an oxfmt config (`.oxfmtrc.json{,c}` or `oxfmt.config.{ts,mts}`) exists, oxfmt owns `format`/`format-check`; Biome then only contributes its `lint` fallback (if any). With `oxfmt: false` or no oxfmt config, Biome owns format — provided `biome: true` and a `biome.json`/`biome.jsonc` exist. oxfmt allows only one config per directory and does not read a `package.json` key.

### Root project

In a single-package repo (a `tsconfig.json` at the workspace root and none nested), the root itself becomes a project — automatically, with nothing in `nx.json`. Add a nested config later and the root project disappears on its own. `includeRoot` forces the behavior either way.

## Inspect

```bash
npx nx show projects              # all inferred projects
npx nx show project <name>        # targets of one project
npx nx run <name>:typecheck
```

## Options

Pass via the plugin tuple in `nx.json`:

```jsonc
{
  "plugins": [
    [
      "@nx-devkit/typescript",
      {
        "tsgo": true,
        "configFile": "tsconfig.json",
        "clean": false,
        "tap": false,
        "coverage": false,
        "oxlint": true,
        "eslint": true,
        "biome": true,
        "oxfmt": true,
        "tsdown": true,
        "testGlob": "**/*.test.{ts,js,mts,mjs}",
        "specGlob": "**/*.spec.{ts,js,mts,mjs}",
        "testCi": false,
        "includeRoot": true,
      },
    ],
  ],
}
```

<!-- option reference consistent with src/types.ts NxDevkitTypescriptOptions -->

| Option        | Type      | Default                       | Effect                                                                                                                                            |
| ------------- | --------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsgo`        | `boolean` | `true`                        | `typecheck` prefers the native compiler: `tsgo` from `@typescript/native-preview`, else `tsc` (native under `typescript@7`/`@typescript/native`). |
| `configFile`  | `string`  | `"tsconfig.json"`             | Config basename that marks a directory as a project.                                                                                              |
| `clean`       | `boolean` | `false`                       | `typecheck` runs `… --build --clean <config>` first.                                                                                              |
| `tap`         | `boolean` | `false`                       | Adds `test:tap` — native runner, TAP reporter, `test-results.tap` output.                                                                         |
| `coverage`    | `boolean` | `false`                       | Adds `test:coverage` — native runner, `--experimental-test-coverage`.                                                                             |
| `oxlint`      | `boolean` | `true`                        | `.oxlintrc.*` infers `lint`.                                                                                                                      |
| `eslint`      | `boolean` | `true`                        | `eslint.config.*` infers `lint` (below oxlint in precedence).                                                                                     |
| `biome`       | `boolean` | `true`                        | `biome.json{,c}` infers `format`/`format-check` (+ `lint` fallback).                                                                              |
| `oxfmt`       | `boolean` | `true`                        | `.oxfmtrc.{json,jsonc}`/`oxfmt.config.{ts,mts}` infers `format`/`format-check` (wins over Biome).                                                 |
| `tsdown`      | `boolean` | `true`                        | `tsdown.config.*` — or a publishable `package.json` + `src/index.ts` — infers `build`/`build:watch`.                                              |
| `testGlob`    | `string`  | `"**/*.test.{ts,js,mts,mjs}"` | Glob for native test files.                                                                                                                       |
| `specGlob`    | `string`  | `"**/*.spec.{ts,js,mts,mjs}"` | Glob for spec files.                                                                                                                              |
| `testCi`      | `boolean \| string` | `false`                       | `true` infers a `test-ci` group plus one `test-ci--<file>` target per test/spec file (DTE sharding). A string names the group.                    |
| `includeRoot` | `boolean` | auto                          | `true`: root is always a project. `false`: never. Unset: only when it is the sole project — self-corrects when nested configs appear.             |

## Skip rules

A `tsconfig.json` is ignored when it sits under `node_modules`, escapes the workspace, or — in a monorepo — at the workspace root (root configs still feed lint/format fallbacks and dependency detection). `includeRoot` overrides the root skip; the skip rules for `node_modules` and escaping paths always apply.

## Executors

| Executor                          | Options                       | Notes                                                                                                     |
| --------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@nx-devkit/typescript:typecheck` | `tsgo`, `configFile`, `clean` | `execFile` on the tool's Node entry — no shell; 10-minute timeout; large `maxBuffer` for compiler output. |
| `@nx-devkit/typescript:build`     | `watch`                       | Non-watch: bounded `execFile`. Watch: `spawn` with inherited stdio, runs until interrupted.               |

## Migrations

The package ships `migrations.json`; `nx migrate @nx-devkit/typescript` replaces legacy `nx:run-commands` typecheck/build targets that use `tsc|tsgo --build <config>` or `tsdown` with the dedicated executors. Only literal command forms are rewritten — shell composition, expansions, and quoted/globbed config paths are left untouched.

**Updating Nx itself.** Always upgrade Nx with `nx migrate` (`nx migrate latest` → review `migrations.json` → `nx migrate --run-migrations` → install → verify → delete `migrations.json`). Never hand-bump `nx`/`@nx/*` version specs or install a newer Nx by hand — the `@nx/devkit` peer range (`^24`) is set by the migration and not hand-bumped. The same rule applies to this repo itself.

**Upgrading the preset separately.** `nx migrate latest` upgrades `nx` and `@nx/*` but does not bump `@nx-devkit/typescript` (its `@nx/devkit` is a regular dependency, not a peer). After upgrading Nx, also run `nx migrate @nx-devkit/typescript` once a compatible release is published, so the preset pulls a devkit matching your Nx major. The `^24` range only reuses a matching devkit when one is already installed; a fresh install resolves the highest version in the range.

## For plugin authors

The preset re-exports its inference helpers so sibling plugins can compose the same logic:

<!-- exported helpers consistent with src/plugin.ts export block -->

```ts
import {
  inferTypecheckTarget,
  inferVitestTargets,
  inferNativeTestTargets,
  inferOxlintTarget,
  inferEslintTarget,
  inferBiomeTargets,
  inferTsdownBuildTarget,
  inferTsdownWatchTarget,
  inferTestCiTargets,
  shouldSkipPath,
  isVerbose,
  logDebug,
  resetCachedEnv,
  globMatch,
  globMatchAsync,
  globFilesAsync,
  globToRegExp,
  expandBraces,
} from '@nx-devkit/typescript';
```

## Verbose logging

`logDebug` prints only with `--verbose` on argv or `NX_VERBOSE_LOGGING=true` (env or workspace `.env`). Messages are prefixed `[nx-typescript]`.

## License

MIT
