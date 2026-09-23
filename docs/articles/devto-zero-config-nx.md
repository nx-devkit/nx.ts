---
title: "I replaced @nx/js + @nx/eslint + @nx/vite boilerplate with one line in nx.json"
description: "Zero-config Nx plugins that infer typecheck, test, lint, format, and build targets from the config files you already keep — no project.json."
tags: [nx, typescript, monorepo, devops]
published: false
---

# I replaced my Nx toolchain boilerplate with one line in `nx.json`

If you've run an Nx monorepo, you know the deal: every new package gets a `project.json` (or `package.json` targets) declaring `build`, `test`, `lint`, `typecheck` — the same four targets, forever, copy-pasted with slightly different paths. Nx's official plugins infer some of this, but they also push their own toolchain opinions: Jest configs, ESLint executors, webpack/vite build setups that don't match a modern TypeScript stack.

I wanted Nx's project graph, caching, and `affected` — with *my* toolchain: tsdown for builds, tsgo for typecheck, oxlint/Biome for lint and format, Vitest or plain `node --test` for tests. So I built plugins that infer targets from the config files that already exist:

```jsonc
// nx.json — that's the whole configuration
{ "plugins": ["@nx-devkit/typescript"] }
```

```bash
npx @nx-devkit/typescript init   # installs nx if missing, registers the plugin in nx.json
```

## What "zero-config" actually means

Each package in the workspace is defined by the config files it *already has*:

| File on disk | Targets you get |
|---|---|
| `tsconfig.json` | `typecheck` (tsgo, falls back to tsc) |
| `vitest.config.ts` | `test`, `test:watch`, `test:coverage` |
| `*.test.ts` (no vitest config) | `test` via native `node --test` |
| `.oxlintrc.json` | `lint` (oxlint) |
| `eslint.config.mjs` | `lint` (eslint, if oxlint doesn't own it) |
| `biome.json` | `format`, `format-check` (+ `lint` fallback) |
| `tsdown.config.ts` | `build`, `build:watch` |

One prerequisite: the preset anchors on `**/tsconfig*.json`, so a directory needs a TypeScript config to become a project — a bare `vitest.config.ts` alone won't infer one.

Add `vitest.config.ts` to a package → `test` appears on the next `nx run`. Delete it → the target disappears. The project graph is derived state, not maintained state.

## The part that was harder than it looks

`createNodesV2` globs are static — you can't "detect then glob". You glob for *config file shapes* and infer targets per match. A few things that bit me:

- **Lint precedence has to be explicit.** oxlint > eslint > biome — each gated on both its option *and* its config file. "Which tool owns `lint`" is a real UX decision; implicit last-write-wins produces flaky diffs.
- **Binaries must resolve like a user would invoke them.** `node_modules/.bin` walk-up resolution, because hoisted monorepo installs (pnpm, bun) break naive `require.resolve`.
- **Executors beat `run-commands` for the heavy tools.** `execFile` on the tool's Node entry — no shell, bounded timeouts, large maxBuffer for compiler output.
- **Single-package repos are the edge case.** A lone `tsconfig` at the root becomes the root project; when any nested config exists, the root is skipped unless `includeRoot: true` explicitly includes it (`includeRoot: false` always excludes it).

## Why not just use `@nx/js` + friends?

You can — it works. The difference is where the abstraction sits. The official plugins infer targets that call *their* executors with *their* conventions. nx-devkit's bet is dumber and thinner: your configs are the source of truth, the plugins translate them into cacheable targets, and the tools run exactly as if you'd typed the command — because that's all they do.

## What's next

The preset is on npm as `@nx-devkit/typescript` (`npx @nx-devkit/typescript init` installs nx if missing and registers the plugin in `nx.json`). The standalone plugins — `@nx-devkit/tsdown`, `@nx-devkit/oxlint`, `@nx-devkit/biome` — exist for single-tool consumers. There's also `@nx-devkit/diagrams` (renders `.mmd`/`.puml`/`.d2` into cached, atomized targets — `nx affected` re-renders only the diagrams that changed) and `@nx-devkit/prepare-for-release` (OIDC trusted-publishing bootstrap).

Repo: https://github.com/nx-devkit/nx.ts — issues and PRs welcome. If you've wanted Nx's graph without its toolchain opinions, this is that.

---

*Drafted for dev.to. Before publishing: update links once the nx.dev plugin-registry listing lands.*
