---
title: "@nx/js vs zero-config inference — an honest look at both sides of the Nx toolchain"
description: "What the official Nx plugins give you, where they stop, and what a config-inference preset (tsdown, Biome, oxlint, tsgo) does differently. Fair trade-offs, not a pitch."
tags: [nx, typescript, monorepo, webdev]
published: false
---

# `@nx/js` vs zero-config inference — an honest look at both sides of the Nx toolchain

The TypeScript toolchain is quietly being rewritten in Rust: oxlint for linting, Biome for lint+format, tsdown (Rolldown) for builds, tsgo for typecheck. I wanted that stack inside an Nx monorepo — and discovered the official plugin set barely covers it:

- `@nx/oxlint` exists — experimental, single-tool
- Biome — community plugins only; official support is an open request (nrwl/nx discussions #35462, #23347)
- tsdown/Rolldown — nothing (official builds are webpack/esbuild/rollup/rspack/vite)
- tsgo — nothing (`@nx/js` typechecks with tsc only)

So I built `@nx-devkit/*` — inference plugins that derive targets from config files instead of generating `project.json`. This post is the honest comparison: where the official approach wins, where it doesn't reach, and who should pick what.

## Two different models

**Official plugins are generator-first.** `nx g @nx/js:lib` scaffolds a package, writes config files, registers executors, wires lint/test integration. The plugin's executors then *own* how the tool runs — options flow through Nx's executor schema into the tool.

**nx-devkit is inference-only.** No generators, no scaffolding. `createNodesV2` globs for config files you already keep and turns them into cacheable targets:

```jsonc
// nx.json — that's the whole configuration
{ "plugins": ["@nx-devkit/typescript"] }
```

| File on disk | Targets you get |
|---|---|
| `tsconfig.json` | `typecheck` (tsgo, falls back to tsc) |
| `vitest.config.ts` | `test`, `test:watch`, `test:coverage` |
| `*.test.ts` (no vitest config) | `test` via native `node --test` |
| `.oxlintrc.json` | `lint` (oxlint) |
| `eslint.config.mjs` | `lint` (eslint, if oxlint doesn't own it) |
| `biome.json` | `format`, `format-check` (+ `lint` fallback) |
| `tsdown.config.ts` | `build`, `build:watch` |

Add `tsdown.config.ts` to a package → `build` appears on the next `nx run`, cacheable, with `dependsOn: ^build`. Delete it → gone. `nx show project` reflects reality, not a file you maintain. One prerequisite: the preset anchors on `**/tsconfig*.json` — a bare `vitest.config.ts` alone won't create a project.

```bash
npx @nx-devkit/typescript init   # installs nx if missing, registers the plugin
```

## Where official `@nx/*` wins — for real

Fairness means saying this plainly:

- **Generators.** `@nx/js:lib`, `@nx/react:app`, `@nx/nest:app` scaffold complete, correctly-wired projects. nx-devkit generates nothing — if you want `nx g` to produce a new library with everything configured, official is the only option.
- **`enforce-module-boundaries`.** The architectural rule ("libs in `domain/` can't import from `app/`-layer") is an official-only feature — and it's the deepest reason teams adopt Nx. nx-devkit has no equivalent; the official `@nx/oxlint` plugin ships it as an oxlint JS plugin, which tells you where the ecosystem's center of gravity is.
- **Migrations.** `nx migrate` rewrites your workspace on upgrades. A three-file inference plugin doesn't need that machinery — because it doesn't generate code to migrate.
- **Battle-testing.** Official plugins carry years of edge cases across Angular/React/Next workspaces, Jest setups, webpack configs. nx-devkit is pre-1.0 with a small user base.
- **Framework gravity.** If your repo is Angular or Next, the official plugins aren't optional — they're the integration.

## Where nx-devkit wins — and it's a real gap, not a niche

- **The Rust-native stack has no official coverage.** tsdown, Biome, tsgo — zero official plugins; oxlint only experimental. If your toolchain is already these tools, official plugins offer you ESLint/Jest/webpack executors you'll immediately rip out.
- **Zero maintained state.** No `project.json` to copy-paste, no drift between "what targets exist" and "what configs exist". The graph is derived.
- **Thinner abstraction.** Targets run the tool's own CLI the way you'd type it — no executor option schema to learn, debug, or fight. What you see in `nx show project` is a plain command.
- **Single-tool granularity.** `@nx-devkit/oxlint` alone works if that's all you want; the preset just composes the same inference.

## The honest verdict

They're not really competitors — they overlap on "turn a package into Nx targets" and diverge on everything else.

- **Pick official `@nx/*`** if you're building apps with framework generators, need module-boundary enforcement, or run the established toolchain (Jest, ESLint, webpack/vite). That's the supported, batteries-included path.
- **Pick nx-devkit** if your monorepo is TypeScript libraries on the modern stack (tsdown/oxlint/Biome/tsgo/Vitest) and you want Nx's graph+cache without adopting a second toolchain's opinions.
- **Compose them** — inference adds targets, it doesn't remove them. `@nx/react` generators and `@nx-devkit/*` inference coexist in one workspace; that hybrid is probably the most common real setup.

## The part that was harder than it looks

`createNodesV2` globs are static — you can't "detect then glob". You glob for *config file shapes* and infer targets per match. A few things that bit me:

- **Lint precedence has to be explicit.** oxlint > eslint > biome — each gated on both its option *and* its config file. "Which tool owns `lint`" is a real UX decision; implicit last-write-wins produces flaky diffs.
- **Binaries must resolve like a user would invoke them.** `node_modules/.bin` walk-up resolution, because hoisted monorepo installs (pnpm, bun) break naive `require.resolve`.
- **Executors beat `run-commands` for the heavy tools.** `execFile` on the tool's Node entry — no shell, bounded timeouts, large maxBuffer for compiler output.
- **Single-package repos are the edge case.** A lone `tsconfig` at the root becomes the root project; when any nested config exists, the root is skipped unless `includeRoot: true` explicitly includes it (`includeRoot: false` always excludes it).

## Caveats

- **Pre-1.0.** Minor versions may add or change inferred targets; pin versions for reproducible CI.
- **Opinionated tool set.** Jest + webpack stacks should stay on official plugins — that's literally what they're for.

## What's next

The preset is on npm as `@nx-devkit/typescript`. The standalone plugins — `@nx-devkit/tsdown`, `@nx-devkit/oxlint`, `@nx-devkit/biome` — exist for single-tool consumers. There's also `@nx-devkit/diagrams` (renders `.mmd`/`.puml`/`.d2` into cached, atomized targets) and `@nx-devkit/prepare-for-release` (OIDC trusted-publishing bootstrap).

Repo: https://github.com/nx-devkit/nx.ts — issues and PRs welcome.
