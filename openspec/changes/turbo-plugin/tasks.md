# Tasks: turbo-plugin

- [x] Scaffold `packages/turbo/` (package.json, tsdown/vitest/tsconfig,
      generators.json)
- [ ] Implement `src/turbo-config.ts` — turbo.json types + parsing
      (`tasks` v2 / `pipeline` v1)
- [ ] Implement `src/workspace.ts` — workspace package discovery
      (package.json `workspaces`, `pnpm-workspace.yaml`, `lerna.json`,
      `packages/*`+`apps/*` fallback, glob expansion)
- [ ] Implement `src/targets.ts` — turbo task → Nx target
      (`dependsOn`, `inputs`/`outputs`, `cache`, `env`, `persistent`)
- [ ] Implement `src/plugin.ts` — `createNodesV2` on `**/turbo.json`:
      root config fans out to workspace packages, `//#` root tasks,
      `<pkg>#<task>` overrides, nested package configs
- [ ] Implement the `init` generator — register the plugin
- [ ] Specs: `workspace.spec.ts`, `targets.spec.ts`, `plugin.spec.ts`,
      `generators/init/generator.spec.ts`
- [ ] README.md + AGENTS.md
- [ ] Gates: test, build, lint, format:check, check:spec,
      openspec validate
