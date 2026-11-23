# @nx-devkit/deploy

Agent guide for working in `packages/deploy/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/deploy/
├── package.json
├── tsdown.config.ts        # entry: plugin, generators/init/generator
├── vitest.config.ts
├── tsconfig.json
├── generators.json
├── src/
│   ├── plugin.ts           # createNodesV2 — provider configs → `deploy`/`dev` targets
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxDeployPluginOptions {
  deployTargetName?: string; // default "deploy"
  devTargetName?: string; // default "dev"
}
```

## Scope rules

- Touch ONLY `packages/deploy/`.
- Do NOT modify other plugin packages or the root `nx.json` — except adding `packages/deploy` to `release.projects` when the bead covers package onboarding.

## Invariants

- Provider map: `wrangler.toml` → `deploy` + `dev`; `fly.toml` → `deploy`; `vercel.json` → `deploy` + `dev`; `netlify.toml` → `deploy`.
- `deploy` MUST be `cache: false` — a deploy is a provider side effect.
- `dev` MUST be `continuous: true` and `cache: false`.
- The workspace root is NOT skipped — single-app repos deploy from root.
- `node_modules` segments and `..` escapes are always skipped.
- Several provider configs in one directory → first match in `PROVIDER_PRECEDENCE` (`wrangler.toml`, `fly.toml`, `vercel.json`, `netlify.toml`) wins the directory.
- `dependsOn` on the project build is added only when a build actually exists (`project.json` target or `package.json` script) — never reference a missing task.
- Credentials via env only — commands never carry tokens. Do not add flag/env argv plumbing for secrets.
- `cwd` is the `{projectRoot}` token so deploy commands auto-discover the owning directory's config.

## TDD workflow

1. Write failing specs in `plugin.spec.ts` (tmp dirs via `mkdtempSync` — one fixture per provider).
2. `bun run test` → RED.
3. Implement to GREEN.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/deploy
bun run test
bun run build
```
