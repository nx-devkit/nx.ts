# Tasks: turbo-plugin

- [x] Scaffold `packages/turbo/` (package.json, tsdown/vitest/tsconfig,
      generators.json)
- [x] Implement `src/turbo-config.ts` — turbo.json types + parsing
      (`tasks` v2 / `pipeline` v1)
- [x] Implement `src/workspace.ts` — workspace package discovery
      (package.json `workspaces`, `pnpm-workspace.yaml`, `lerna.json`,
      `packages/*`+`apps/*` fallback, glob expansion)
- [x] Implement `src/targets.ts` — turbo task → Nx target
      (`dependsOn`, `inputs`/`outputs`, `cache`, `env`, `persistent`)
- [x] Implement `src/plugin.ts` — `createNodesV2` on `**/turbo.json`:
      root config fans out to workspace packages, `//#` root tasks,
      `<pkg>#<task>` overrides, nested package configs
- [x] Implement the `init` generator — register the plugin
- [x] Specs: `workspace.spec.ts`, `targets.spec.ts`, `plugin.spec.ts`,
      `generators/init/generator.spec.ts`
- [x] README.md + AGENTS.md
- [x] Gates: test, build, lint, format:check, check:spec,
      openspec validate
