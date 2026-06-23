# nx-devkit

> Zero-config Nx inference plugins for TypeScript projects. Extend Nx with build/typecheck/lint/format/test targets derived from the config files you already keep.

This repository is a monorepo of Nx tool plugins published under the `@nx-devkit` scope. Each plugin inspects a single config file already present in a TypeScript project and auto-injects the matching Nx target via `createNodesV2`. Consumers do not write `project.json`; targets are derived from files they already keep (`tsdown.config.ts`, `tsconfig.json`, `.oxlintrc.json`, `biome.json`, `vitest.config.ts`).

We **extend Nx**, we do not replace it. See [`skills/nx-vs-nx/SKILL.md`](./skills/nx-vs-nx/SKILL.md).

## Quickstart

```bash
bun install
bun run build
bun test
bun run lint
bun run check:spec
bash scripts/e2e.sh
```

The `apps/demo/` workspace is the living documentation — it wires all five plugins and runs against the e2e script.

## Plugin matrix

| Plugin | Trigger file | Inferred targets | Package |
|---|---|---|---|
| `@nx-devkit/tsdown` | `**/tsdown.config.ts` | `build` | [`packages/tsdown`](./packages/tsdown) |
| `@nx-devkit/oxlint` | `**/.oxlintrc.*` | `lint` | [`packages/oxlint`](./packages/oxlint) |
| `@nx-devkit/biome` | `**/biome.json{,c}` | `format`, `format-check`, `lint` | [`packages/biome`](./packages/biome) |
| `@nx-devkit/typescript` | `**/tsconfig.json` + `vitest.config.*` | `typecheck`, `test`, `test:watch`, `test:coverage` | [`packages/typescript-preset`](./packages/typescript-preset) |
| `@nx-devkit/prepare-for-release` | (executor + generator) | `prepare-for-release` on the `tools` project | [`packages/prepare-for-release`](./packages/prepare-for-release) |

## Skills

Install the corresponding skill for any agent that supports [skills.sh](https://skills.sh):

```bash
npx skills add ThePlenkov/nx.ts
```

Seven skills ship in [`skills/`](./skills): `nx-devkit-tsdown`, `nx-devkit-oxlint`, `nx-devkit-biome`, `nx-devkit-typescript`, `nx-devkit-prepare-for-release`, `nx-vs-nx`, `nx-e2e-demo`.

## Release flow

1. **One-time bootstrap (manual, MFA required).** From a fresh clone, run `@nx-devkit/prepare-for-release:publish-placeholder` to publish `0.0.0` placeholders for every package. Then, locally, run each printed `npm trust github <pkg> --file release.yml --repo ThePlenkov/nx.ts --allow-publish` command to enable GitHub OIDC trusted publishing for that package.
2. **Ongoing releases (CI).** Push to `main` → `.github/workflows/release.yml` runs `npx nx release --skip-publish` (dry-run check) + `npx nx release publish` (OIDC trusted publishing). CI uses the npm CLI (`npx`), not bun, because bun does not yet support npm OIDC trusted publishing. Install/build/test still use bun because they are faster.

`bunx nx release --skip-publish --dry-run` locally confirms the versioning intent without touching the registry.

## Adding a new plugin

```bash
bunx nx g @nx-devkit/prepare-for-release:init
```

This adds the plugin to `nx.json` and creates a `tools` project with a `prepare-for-release` target — so a brand-new plugin package can be published in one command without manual npm setup.

## License

MIT. See [`LICENSE`](./LICENSE).