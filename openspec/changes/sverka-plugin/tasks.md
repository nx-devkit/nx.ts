# Tasks: sverka-plugin

- [x] Scaffold `packages/sverka/` (package.json, tsdown/vitest/tsconfig,
      executors.json, generators.json)
- [x] Implement `src/graph.ts` — config discovery, Definition Graph loading,
      `@sverka/*` resolve fallback
- [x] Implement `src/plan.ts` — entries, reachable steps, dependencies
- [x] Implement `src/targets.ts` — step → Nx target (inputs, outputs,
      dependsOn, cache)
- [x] Implement `src/plugin.ts` — createNodesV2, one target per step
- [x] Implement the `@nx-devkit/sverka:step` executor — single-step plan,
      artifact/value bridge
- [x] Implement the `init` generator — register the plugin, install peer deps
- [x] Implement the `config` generator — config from the project + GitHub checks
- [x] Specs: `plugin.spec.ts`, `executors/step/executor.spec.ts`,
      `generators/init/generator.spec.ts`, `generators/config/generator.spec.ts`
- [x] README.md + AGENTS.md
- [x] Register in root `nx.json` (`plugins` + `release.projects`)
- [x] Gates: test, build, lint, format:check, check:spec, openspec validate
