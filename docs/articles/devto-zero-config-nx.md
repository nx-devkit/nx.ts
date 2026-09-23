---
title: "Running the Rust-native TypeScript toolchain inside Nx — tsdown, Biome, tsgo"
description: "Nx has no official plugins for tsdown builds, Biome formatting, or tsgo typecheck. These inference plugins cover them — targets derived from config files, no project.json."
tags: [nx, typescript, monorepo, webdev]
published: false
---

# Running the Rust-native TypeScript toolchain inside Nx — tsdown, Biome, tsgo

The TypeScript toolchain is quietly being rewritten in Rust: oxlint for linting, Biome for lint+format, tsdown (Rolldown) for builds, tsgo for typecheck. It's fast and it composes — but if your monorepo runs on Nx, there's a gap: **Nx's official plugin set barely covers this stack.**

- `@nx/oxlint` exists — experimental, single-tool
- Biome — community plugins only, no official one
- tsdown/Rolldown — nothing (official builds are webpack/esbuild/rollup/rspack/vite)
- tsgo — nothing (`@nx/js` typechecks with tsc only)

So adopting the modern stack inside Nx means hand-writing `project.json` targets per package — the same `build`, `lint`, `format`, `typecheck` declarations, copy-pasted with slightly different paths:

```jsonc
// packages/lib-a/project.json — and again in lib-b, lib-c, ...
{
  "targets": {
    "build":     { "executor": "...", "options": {} /* … */ },
    "test":      { "executor": "...", "options": {} /* … */ },
    "lint":      { "executor": "...", "options": {} /* … */ },
    "typecheck": { "executor": "...", "options": {} /* … */ }
  }
}
```

I wanted Nx's project graph, caching, and `affected` *on* that toolchain — so I built inference plugins that derive targets from the config files that already exist:

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

Add `tsdown.config.ts` to a package → `build` appears on the next `nx run`, cacheable, with `dependsOn: ^build`. Delete it → the target disappears. `nx show project lib-a` reflects reality, not a file you have to remember to update. The project graph is derived state, not maintained state.

## The part that was harder than it looks

`createNodesV2` globs are static — you can't "detect then glob". You glob for *config file shapes* and infer targets per match. A few things that bit me:

- **Lint precedence has to be explicit.** oxlint > eslint > biome — each gated on both its option *and* its config file. "Which tool owns `lint`" is a real UX decision; implicit last-write-wins produces flaky diffs.
- **Binaries must resolve like a user would invoke them.** `node_modules/.bin` walk-up resolution, because hoisted monorepo installs (pnpm, bun) break naive `require.resolve`.
- **Executors beat `run-commands` for the heavy tools.** `execFile` on the tool's Node entry — no shell, bounded timeouts, large maxBuffer for compiler output.
- **Single-package repos are the edge case.** A lone `tsconfig` at the root becomes the root project; when any nested config exists, the root is skipped unless `includeRoot: true` explicitly includes it (`includeRoot: false` always excludes it).

## vs. the official plugins

Different bet, not a hostile one. The official plugins infer targets that call *their* executors with *their* conventions — and they're only published per-tool, which is why half the Rust-native stack has no coverage at all. nx-devkit's layer is dumber and thinner: your configs are the source of truth, one preset translates all of them into cacheable targets, and the tools run exactly as if you'd typed the command. And it composes — inference adds targets, it doesn't remove them, so `@nx/react` generators and `@nx-devkit/*` inference can coexist in one workspace.

## Trade-offs, honestly

- **Pre-1.0.** Minor versions may add or change inferred targets; pin versions if your CI needs reproducible graphs.
- **Toolchain-covered, not ecosystem-covered.** If you need `@nx/js` generators (library scaffolding) or framework integrations (Angular, React, Next), official plugins still earn their place.
- **Opinionated tool set.** If your stack is Jest + webpack, this preset isn't for you.

## What's next

The preset is on npm as `@nx-devkit/typescript` (`npx @nx-devkit/typescript init` installs nx if missing and registers the plugin in `nx.json`). The standalone plugins — `@nx-devkit/tsdown`, `@nx-devkit/oxlint`, `@nx-devkit/biome` — exist for single-tool consumers. There's also `@nx-devkit/diagrams` (renders `.mmd`/`.puml`/`.d2` into cached, atomized targets — `nx affected` re-renders only the diagrams that changed) and `@nx-devkit/prepare-for-release` (OIDC trusted-publishing bootstrap).

Repo: https://github.com/nx-devkit/nx.ts — issues and PRs welcome. If you've wanted Nx's graph on the Rust-native toolchain, this is that.
