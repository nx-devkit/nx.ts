# nx-devkit

[![CI](https://github.com/nx-devkit/nx.ts/actions/workflows/ci.yml/badge.svg)](https://github.com/nx-devkit/nx.ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@nx-devkit/typescript)](https://www.npmjs.com/package/@nx-devkit/typescript)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Zero-config Nx plugins for modern TypeScript tooling. Register one plugin and get `typecheck`, `test`, `lint`, `format`, and `build` targets derived from the config files your project already keeps — no `project.json`, no target boilerplate.

## Why

Nx's project graph, caching, and `affected` detection are excellent; its built-in TypeScript tooling is not. nx-devkit keeps the graph and replaces the toolchain:

- **tsdown** instead of `tsc` emit for builds
- **TypeScript 7** (`@typescript/native` → `typescript@7`, or legacy `@typescript/native-preview`/`tsgo`) for typecheck, with `tsc` fallback
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

<!-- package matrix generated from packages/*/package.json + each plugin's createNodesV2 glob — keep in sync -->

| Package                                                                      | Trigger                                                | What it infers                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@nx-devkit/typescript`](./packages/typescript-preset/README.md)            | `**/tsconfig*.json + tool configs`                     | Infers typecheck, test, lint, format, and build targets from config files you already keep **Recommended entry point.**                                                                                                                   |
| [`@nx-devkit/tsdown`](./packages/tsdown/README.md)                           | `**/tsdown.config.ts`                                  | Infers a cached build target from tsdown.config.ts                                                                                                                                                                                        |
| [`@nx-devkit/oxlint`](./packages/oxlint/README.md)                           | `**/.oxlintrc.*`                                       | Infers a cached lint target from .oxlintrc config files                                                                                                                                                                                   |
| [`@nx-devkit/biome`](./packages/biome/README.md)                             | `**/biome.json{,c}`                                    | Infers format, format-check, and lint targets from biome.json                                                                                                                                                                             |
| [`@nx-devkit/vitest`](./packages/vitest/README.md)                           | `**/vitest.config.*`                                   | Infers cached test, test:watch, and test:coverage targets from vitest.config.*                                                                                                                                                            |
| [`@nx-devkit/oxfmt`](./packages/oxfmt/README.md)                             | `**/{.oxfmtrc.*,oxfmt.config.*}`                       | Infers format and format-check targets from .oxfmtrc/oxfmt.config files                                                                                                                                                                   |
| [`@nx-devkit/eslint`](./packages/eslint/README.md)                           | `**/eslint.config.*`                                   | eslint.config files infer a cached lint target (plus lint:fix)                                                                                                                                                                            |
| [`@nx-devkit/markdownlint`](./packages/markdownlint/README.md)               | `**/.markdownlint*`                                    | markdownlint config files infer a cached lint-md target                                                                                                                                                                                   |
| [`@nx-devkit/commitlint`](./packages/commitlint/README.md)                   | `**/{commitlint.config.*,.commitlintrc*,package.json}` | commitlint config files infer a commitlint target                                                                                                                                                                                         |
| [`@nx-devkit/cspell`](./packages/cspell/README.md)                           | `**/{cspell*,.cspell*,package.json}`                   | cspell config files infer a cached spell-check target                                                                                                                                                                                     |
| [`@nx-devkit/knip`](./packages/knip/README.md)                               | `**/{knip.*,package.json}`                             | knip config files infer a cached knip target                                                                                                                                                                                              |
| [`@nx-devkit/pkg-lint`](./packages/pkg-lint/README.md)                       | `**/package.json (publishable)`                        | Every publishable package.json infers a cached lint-pkg target running publint + attw --pack                                                                                                                                              |
| [`@nx-devkit/playwright`](./packages/playwright/README.md)                   | `**/playwright.config.*`                               | playwright.config files infer a cached e2e target (plus e2e:ui and e2e:update-snapshots)                                                                                                                                                  |
| [`@nx-devkit/docs`](./packages/docs/README.md)                               | `**/{.vitepress/config,astro.config}.*`                | vitepress/astro configs (incl. Starlight) infer docs:dev, docs:build and docs:preview targets                                                                                                                                             |
| [`@nx-devkit/diagrams`](./packages/diagrams/README.md)                       | `**/*.{puml,mmd,dot,d2,bpmn,excalidraw,…} + md fences` | Renders text-diagram sources (PlantUML, Mermaid, D2, Graphviz, BPMN, Excalidraw) into cached, atomized targets via Kroki or local renderers                                                                                               |
| [`@nx-devkit/boundaries`](./packages/boundaries/README.md)                   | `**/package.json with nx.tags`                         | Linter-agnostic Nx plugin: enforces module-boundary depConstraints between tagged projects                                                                                                                                                |
| [`@nx-devkit/deps`](./packages/deps/README.md)                               | `**/{syncpack*,.manypkg.json,package.json,lockfiles}`  | Syncpack config (or manypkg on the workspaces root) infers a cached deps:check target plus opt-in deps:fix                                                                                                                                |
| [`@nx-devkit/ci-lint`](./packages/ci-lint/README.md)                         | `.github/workflows/*.{yml,yaml}`                       | Workflow files infer a cached lint-ci target on the root project — actionlint + zizmor                                                                                                                                                    |
| [`@nx-devkit/git-hooks`](./packages/git-hooks/README.md)                     | `**/{lefthook*,.pre-commit-config.yaml}`               | lefthook/pre-commit configs infer hooks:install, hooks:run, and per-hook hooks:<name> targets                                                                                                                                             |
| [`@nx-devkit/skill`](./packages/skill/README.md)                             | `**/SKILL.md`                                          | For agent skills: any SKILL.md becomes a project with build, lint, validate, os-check, and size-check targets                                                                                                                             |
| [`@nx-devkit/skillspector`](./packages/skillspector/README.md)               | `**/SKILL.md`                                          | For SkillSpector security scanning: any SKILL.md gets a scan target reporting vulnerabilities, secrets, and risky patterns — with SARIF output and CI annotations                                                                         |
| [`@nx-devkit/openspec`](./packages/openspec/README.md)                       | `**/openspec/config.yaml`                              | openspec/config.yaml infers a cached spec-validate target plus per-change spec-validate:<id> targets                                                                                                                                      |
| [`@nx-devkit/sverka`](./packages/sverka/README.md)                           | `**/sverka.config.*`                                   | A sverka config infers one cached Nx target per sverka step                                                                                                                                                                               |
| [`@nx-devkit/turbo`](./packages/turbo/README.md)                             | `**/turbo.json`                                        | Infers Nx targets from turbo.json                                                                                                                                                                                                         |
| [`@nx-devkit/moon`](./packages/moon/README.md)                               | `**/moon.{yml,yaml}`                                   | Infers Nx targets from moon.yml                                                                                                                                                                                                           |
| [`@nx-devkit/make`](./packages/make/README.md)                               | `**/Makefile`                                          | Makefile rules infer make:<name> targets                                                                                                                                                                                                  |
| [`@nx-devkit/just`](./packages/just/README.md)                               | `**/{justfile,JUSTFILE,.justfile,just.just}`           | justfile recipes become just:<name> targets                                                                                                                                                                                               |
| [`@nx-devkit/taskfile`](./packages/taskfile/README.md)                       | `**/{Taskfile,taskfile}*.y{ml,aml}`                    | Taskfile.yml entries infer task:* targets                                                                                                                                                                                                 |
| [`@nx-devkit/cargo`](./packages/cargo/README.md)                             | `**/Cargo.toml`                                        | Cargo.toml manifests infer Nx projects with `build`/`test`/`clippy`/`fmt` targets — incl. workspaces and path-dep edges                                                                                                                   |
| [`@nx-devkit/go`](./packages/go/README.md)                                   | `**/{go.work,go.mod,.golangci.*}`                      | go.work/go.mod files infer build, test, vet, and golangci-lint targets                                                                                                                                                                    |
| [`@nx-devkit/python`](./packages/python/README.md)                           | `**/pyproject.toml`                                    | Infers Nx targets from pyproject.toml — pytest, ruff, ty/pyright, and uv/poetry lock targets                                                                                                                                              |
| [`@nx-devkit/drizzle`](./packages/drizzle/README.md)                         | `**/drizzle.config.*`                                  | drizzle.config.* files infer db:generate, db:migrate, db:push, db:studio, and db:check targets                                                                                                                                            |
| [`@nx-devkit/prisma`](./packages/prisma/README.md)                           | `**/{schema.prisma,prisma.config.*}`                   | schema.prisma / prisma.config.* infer db:generate, db:migrate, db:migrate-deploy, db:studio, db:seed targets                                                                                                                              |
| [`@nx-devkit/terraform`](./packages/terraform/README.md)                     | `**/*.tf`                                              | Directories containing *.tf files infer tf:fmt, tf:validate, and tf:plan targets                                                                                                                                                          |
| [`@nx-devkit/dotenv`](./packages/dotenv/README.md)                           | `**/{.env.example,.env.sample}`                        | Env sample files infer a cacheable env:check target that fails loud on missing env vars                                                                                                                                                   |
| [`@nx-devkit/dotfiles`](./packages/dotfiles/README.md)                       | `**/{.chezmoiversion,*.install.conf.yaml}`             | Chezmoi and dotbot marker files infer dotfiles:diff, dotfiles:apply, dotfiles:doctor, and dotfiles:install targets                                                                                                                        |
| [`@nx-devkit/bazel`](./packages/bazel/README.md)                             | `**/{BUILD,BUILD.bazel,WORKSPACE*,MODULE.bazel}`       | BUILD/BUILD.bazel files infer bazel:build and bazel:test targets                                                                                                                                                                          |
| [`@nx-devkit/dagger`](./packages/dagger/README.md)                           | `**/dagger.json`                                       | dagger.json infers dagger:call / dagger:call:<fn> pipeline targets per Dagger module                                                                                                                                                      |
| [`@nx-devkit/deploy`](./packages/deploy/README.md)                           | `**/{wrangler.toml,fly.toml,vercel.json,netlify.toml}` | wrangler.toml, fly.toml, vercel.json and netlify.toml infer uncached deploy (and continuous dev) targets                                                                                                                                  |
| [`@nx-devkit/remote-cache`](./packages/remote-cache/README.md)               | `server + nx.json wiring`                              | CREEP-safe self-hosted Nx remote cache: a minimal server + client implementing the Nx remote-cache OpenAPI spec with immutable artifacts (409 on existing keys), token-scoped branch/workspace namespacing, and content-hash verification |
| [`@nx-devkit/nx-cloud`](./packages/nx-cloud/README.md)                       | `nx.json`                                              | Adds an nx-cloud-rotate target to the workspace root — rolls over to a fresh Nx Cloud organization when quota is exhausted                                                                                                                |
| [`@nx-devkit/release`](./packages/release/README.md)                         | `project.json with publish executor`                   | Zero-config Nx plugin for automated npm releases via CI — version bump, OIDC publish, git tag, and GitHub Release, fully idempotent                                                                                                       |
| [`@nx-devkit/prepare-for-release`](./packages/prepare-for-release/README.md) | `**/{package,project}.json`                            | Bootstraps npm publishing: 0.0.0 placeholder releases for unpublished packages plus OIDC trusted-publishing setup                                                                                                                         |
| [`@nx-devkit/create`](./packages/create-nx-devkit/README.md)                 | `npm create @nx-devkit` (CLI)                          | Bootstrap a zero-config Nx monorepo in one command                                                                                                                                                                                        |

The preset subsumes the standalone tsdown/oxlint/biome/vitest plugins; they stay available for single-tool consumers.

## Requirements

- **Node.js** ≥ 22.18 (LTS: 22 "Jod", 24 "Krypton", 26 "Lithium" are all supported) — the preset discovers configs with `fs.globSync`, which does not exist on older lines
- **Nx** `^24` — installed automatically by `init` when missing
- **Package manager** — any of npm / pnpm / yarn / bun; binaries are resolved from `node_modules/.bin`
- **Peer deps** — `typescript` is the only required peer; `@nx/devkit` ships as a regular dependency (auto-installed, its own peer range carries the `nx` compatibility). **Optional tool peers** — `vitest`, `oxlint`, `eslint`, `@biomejs/biome`, `tsdown`: install only what your configs imply. The native compiler (typescript@7 via the `@typescript/native` alias, or `@typescript/native-preview`/`tsgo`) is optional and undeclared — add it for faster `typecheck`. `init` installs whatever is missing for the configs it detects.

## Stability

All `@nx-devkit/*` packages are pre-1.0: minor versions may add or change inferred targets and option defaults; patches are fixes only. Check per-package `CHANGELOG.md` files before upgrading, and pin exact versions if your CI needs reproducible graphs.

**What 1.0 means here.** A package graduates to 1.0 when all of these hold:

- **Inferred contract frozen** — target names, `inputs`/`outputs`, and `dependsOn` wiring stop changing in minor versions (new _targets_ may still be added).
- **Options schema frozen** — option renames/removals require a major bump; additions stay minor.
- **Verified compat range** — CI exercises the packed plugin against every supported Nx major (`e2e-packed` matrix), not just the newest.
- **Naming settled** — the `packages/typescript-preset` → `@nx-devkit/typescript` directory/package split is either accepted as documented or renamed once, before 1.0.
- **Migrations shipped for breaks** — any change that alters consumer `nx.json` or project layout comes with an `nx migrate` entry (the preset already ships `migrations.json`).

**Updating Nx.** Nx is always upgraded with `nx migrate` (`nx migrate latest` → review `migrations.json` → `nx migrate --run-migrations` → install → verify → delete `migrations.json`). Never hand-bump `nx`/`@nx/*` version specs or install a newer Nx by hand — in this repo or in any project that uses `@nx-devkit/*`. The peer range (`@nx/devkit` `^24`) is set by the migration and not hand-bumped.

## When to use — and when not

Use nx-devkit if your Nx workspace is a modern TypeScript toolchain and you want the project graph, caching, and `affected` without maintaining `project.json` targets per package — `tsconfig.json`, `vitest.config.ts`, `biome.json`, and friends _are_ the project definition.

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

**`lint` ran the wrong tool.** Lint has an explicit precedence: oxlint > eslint > biome, and each requires both its option enabled and its config present. `oxlint: false` hands `lint` to ESLint only when `eslint: true` _and_ an `eslint.config.*` exists — otherwise Biome's fallback takes it. See the [preset README](./packages/typescript-preset/README.md#lint-precedence).

**`command not found` / binary resolution errors.** Inferred targets call tool binaries from `node_modules/.bin` — the tool must be a devDependency somewhere reachable from the project root (hoisted installs work). Run `npx @nx-devkit/typescript init` to install the tools your configs imply.

**The workspace root isn't a project.** By design in monorepos: the root becomes a project only when it's the sole `tsconfig`. Force it either way with the `includeRoot` option.

## How it works

Each plugin implements Nx's `createNodesV2` API: during project-graph construction it globs for config files, then emits project nodes whose targets call the tool binaries — the same way Nx's own `@nx/*` plugins infer targets. Most targets are `nx:run-commands` (binaries resolved from `node_modules/.bin`, `cwd` = project root); the typecheck/build targets use dedicated executors that launch the tool's entry point directly (`execFile`/`spawn`, no shell), with walk-up `node_modules` resolution so hoisted monorepo installs work.

Because inference is per-run, the graph always reflects the files on disk: add `vitest.config.ts` and `test` appears. A single-package repo (a `tsconfig` at the root, none nested) gets a root project; the first nested `tsconfig` turns that off automatically — `includeRoot` on the preset forces the behavior either way.

## Repository map

<!-- top-level layout consistent with this repository's directories -->

| Path                 | Contents                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/`          | The publishable plugins above (+ private `internal` helpers). Note: `packages/typescript-preset` publishes as `@nx-devkit/typescript`                                |
| `apps/demo/`         | Working demo workspace exercising the plugins                                                                                                                        |
| `skills/`            | Project-facing agent skills (`nx-devkit-typescript`, `nx-skill`, …) — built, linted, validated, and scanned through this repo's own `skill` + `skillspector` plugins |
| `docs/diagrams/`     | Mermaid sources rendered to SVG through the `diagrams` plugin                                                                                                        |
| `tools/`             | Internal workspace tooling (`skills-compiler`, vendored; private)                                                                                                    |
| `scripts/`           | `e2e.sh`, `spec-check.ts`, `rewrite-workspace-protocol.ts`, skill checks                                                                                             |
| `.github/workflows/` | `ci.yml` (lint/build/test + skill scans + diagram builds), `release.yml` (e2e + OIDC publish)                                                                        |

## Contributing

| Audience          | Doc                                    |
| ----------------- | -------------------------------------- |
| Human contributor | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| AI coding agent   | [`AGENTS.md`](./AGENTS.md)             |
| Code reviewer     | [`REVIEW.md`](./REVIEW.md)             |

## License

MIT — see [`LICENSE`](./LICENSE).
