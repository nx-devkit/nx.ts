# nx-devkit

[![CI](https://github.com/nx-devkit/nx.ts/actions/workflows/ci.yml/badge.svg)](https://github.com/nx-devkit/nx.ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@nx-devkit/typescript)](https://www.npmjs.com/package/@nx-devkit/typescript)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Zero-config Nx plugins for modern TypeScript tooling. Register one plugin and get `typecheck`, `test`, `lint`, `format`, and `build` targets derived from the config files your project already keeps — no `project.json`, no target boilerplate.

## Why

Nx's project graph, caching, and `affected` detection are excellent; its built-in TypeScript tooling is not. nx-devkit keeps the graph and replaces the toolchain:

- **tsdown** instead of `tsc` emit for builds
- **tsgo** (`@typescript/native-preview`) for typecheck, with `tsc` fallback
- **oxlint / ESLint / Biome** for lint, **Biome** for format
- **Vitest**, or the native `node --test` runner when no Vitest config exists
- **`createNodesV2` inference** — targets appear because `tsconfig.json` or `biome.json` exists, not because someone edited `project.json`

## Quick start

```bash
npx @nx-devkit/typescript init
```

In any workspace — Nx or plain TypeScript — this registers the preset in `nx.json`, detects your config files, installs missing tool dependencies, and prints the inferred targets. Works for single-package repos and monorepos.

Manual alternative:

```bash
bun add -D @nx-devkit/typescript   # or npm/pnpm/yarn add -D
```

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/typescript"] }
```

## Packages

<!-- package matrix consistent with packages/*/package.json names and each plugin's createNodesV2 glob -->

| Package | Trigger | What you get |
|---|---|---|
| [`@nx-devkit/typescript`](./packages/typescript-preset/README.md) | `**/tsconfig*.json` + tool configs | Full preset: `typecheck`, `test`, `lint`, `format`, `build` (+ watch/coverage variants). **Recommended entry point.** |
| [`@nx-devkit/tsdown`](./packages/tsdown/README.md) | `**/tsdown.config.ts` | Standalone `build` target |
| [`@nx-devkit/oxlint`](./packages/oxlint/README.md) | `**/.oxlintrc.*` | Standalone `lint` target |
| [`@nx-devkit/biome`](./packages/biome/README.md) | `**/biome.json{,c}` | Standalone `format`, `format-check`, `lint` |
| [`@nx-devkit/skill`](./packages/skill/README.md) | `**/SKILL.md` | Skill lifecycle: `build`, `lint`, `validate`, `os-check`, `size-check` |
| [`@nx-devkit/skillspector`](./packages/skillspector/README.md) | `**/SKILL.md` | `scan` target — SkillSpector security scans with SARIF + CI annotations |
| [`@nx-devkit/diagrams`](./packages/diagrams/README.md) | `**/*.{mmd,puml,dot,d2,bpmn,excalidraw,…}` | `diagrams` target — renders diagram sources via Kroki or local command overrides |
| [`@nx-devkit/nx-cloud`](./packages/nx-cloud/README.md) | `nx.json` | `nx-cloud-rotate` target on the root project — rebinds to a fresh Nx Cloud org/workspace |
| [`@nx-devkit/release`](./packages/release/README.md) | `nx g @nx-devkit/release:init` | Automated npm releases: version bump, OIDC publish, tag push, GitHub Release — all idempotent |
| [`@nx-devkit/prepare-for-release`](./packages/prepare-for-release/README.md) | Every non-root `package.json` with `name` + `private !== true` | `prepare-for-release` target per package — idempotent npm placeholder publishing + OIDC trust |
| [`@nx-devkit/release`](./packages/release/README.md) | `project.json` referencing the `publish` executor | Automated npm releases from CI — version bump, OIDC publish, git tag, GitHub Release |
| [`@nx-devkit/nx-cloud`](./packages/nx-cloud/README.md) | `nx.json` at workspace root | `nx-cloud-rotate` target on the root project — roll over to a fresh Nx Cloud org when quota runs out |
| [`@nx-devkit/diagrams`](./packages/diagrams/README.md) | `**/*.{puml,plantuml,mmd,mermaid,dot,gv,d2,bpmn,excalidraw}` + diagram fences in `*.md` | Cached, atomized `diagram-*` render targets via Kroki, Docker, or local renderers |

The preset subsumes the standalone tsdown/oxlint/biome plugins; they stay available for single-tool consumers.

## Requirements

- **Node.js** ≥ 22.14 — the preset discovers configs with `fs.globSync`, which does not exist on older lines
- **Nx** `^22 || ^23` — installed automatically by `init` when missing
- **Package manager** — any of npm / pnpm / yarn / bun; binaries are resolved from `node_modules/.bin`
- **Peer deps** — `typescript` is the only required peer; `@nx/devkit` ships as a regular dependency (auto-installed, its own peer range carries the `nx` compatibility). **Optional tool peers** — `vitest`, `oxlint`, `eslint`, `@biomejs/biome`, `tsdown`: install only what your configs imply. `@typescript/native-preview` (tsgo) is optional and undeclared — add it for faster `typecheck`. `init` installs whatever is missing for the configs it detects.

## Stability

All `@nx-devkit/*` packages are pre-1.0: minor versions may add or change inferred targets and option defaults; patches are fixes only. Check per-package `CHANGELOG.md` files before upgrading, and pin exact versions if your CI needs reproducible graphs.

**What 1.0 means here.** A package graduates to 1.0 when all of these hold:

- **Inferred contract frozen** — target names, `inputs`/`outputs`, and `dependsOn` wiring stop changing in minor versions (new *targets* may still be added).
- **Options schema frozen** — option renames/removals require a major bump; additions stay minor.
- **Verified compat range** — CI exercises the packed plugin against every supported Nx major (`e2e-packed` matrix), not just the newest.
- **Naming settled** — the `packages/typescript-preset` → `@nx-devkit/typescript` directory/package split is either accepted as documented or renamed once, before 1.0.
- **Migrations shipped for breaks** — any change that alters consumer `nx.json` or project layout comes with an `nx migrate` entry (the preset already ships `migrations.json`).

## When to use — and when not

Use nx-devkit if your Nx workspace is a modern TypeScript toolchain and you want the project graph, caching, and `affected` without maintaining `project.json` targets per package — `tsconfig.json`, `vitest.config.ts`, `biome.json`, and friends *are* the project definition.

Stick with the official `@nx/*` plugins if you rely on their generators (library scaffolding, webpack/vite bundling configs) or need Jest/ESLint-specific Nx integrations beyond running the tools — nx-devkit deliberately replaces the toolchain layer, not the Nx ecosystem. It composes fine alongside official plugins: inference adds targets, it does not remove them.

## Troubleshooting

**A target I expected isn't showing up.** Check what Nx inferred:

```bash
npx nx show project <name>          # lists every inferred target
npx nx reset && npx nx show projects  # clear the daemon cache, re-run inference
```

Inference is file-driven — the trigger config (`vitest.config.*`, `.oxlintrc.*`, …) must exist inside the project directory (root configs act as fallbacks for lint/format only). Enable verbose logging to see each decision:

```bash
NX_VERBOSE_LOGGING=true npx nx show projects   # or pass --verbose
```

**`lint` ran the wrong tool.** Lint has an explicit precedence: oxlint > eslint > biome, and each requires both its option enabled and its config present. `oxlint: false` hands `lint` to ESLint only when `eslint: true` *and* an `eslint.config.*` exists — otherwise Biome's fallback takes it. See the [preset README](./packages/typescript-preset/README.md#lint-precedence).

**`command not found` / binary resolution errors.** Inferred targets call tool binaries from `node_modules/.bin` — the tool must be a devDependency somewhere reachable from the project root (hoisted installs work). Run `npx @nx-devkit/typescript init` to install the tools your configs imply.

**The workspace root isn't a project.** By design in monorepos: the root becomes a project only when it's the sole `tsconfig`. Force it either way with the `includeRoot` option.

## How it works

Each plugin implements Nx's `createNodesV2` API: during project-graph construction it globs for config files, then emits project nodes whose targets call the tool binaries — the same way Nx's own `@nx/*` plugins infer targets. Most targets are `nx:run-commands` (binaries resolved from `node_modules/.bin`, `cwd` = project root); the typecheck/build targets use dedicated executors that launch the tool's entry point directly (`execFile`/`spawn`, no shell), with walk-up `node_modules` resolution so hoisted monorepo installs work.

Because inference is per-run, the graph always reflects the files on disk: add `vitest.config.ts` and `test` appears. A single-package repo (a `tsconfig` at the root, none nested) gets a root project; the first nested `tsconfig` turns that off automatically — `includeRoot` on the preset forces the behavior either way.

## Repository map

<!-- top-level layout consistent with this repository's directories -->

| Path | Contents |
|---|---|
| `packages/` | The publishable plugins above (+ private `internal` helpers). Note: `packages/typescript-preset` publishes as `@nx-devkit/typescript` |
| `apps/demo/` | Working demo workspace exercising the plugins |
| `skills/` | Project-facing agent skills (`nx-devkit-typescript`, `nx-skill`, …) — built, linted, validated, and scanned through this repo's own `skill` + `skillspector` plugins |
| `docs/diagrams/` | Mermaid sources rendered to SVG through the `diagrams` plugin |
| `tools/` | Internal workspace tooling (`skills-compiler`, vendored; private) |
| `scripts/` | `e2e.sh`, `spec-check.ts`, `rewrite-workspace-protocol.ts`, skill checks |
| `.github/workflows/` | `ci.yml` (lint/build/test + skill scans + diagram builds), `release.yml` (e2e + OIDC publish) |

## Contributing

| Audience | Doc |
|---|---|
| Human contributor | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| AI coding agent | [`AGENTS.md`](./AGENTS.md) |
| Code reviewer | [`REVIEW.md`](./REVIEW.md) |

## License

MIT — see [`LICENSE`](./LICENSE).
