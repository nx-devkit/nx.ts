# Tasks: eslint plugin

- [x] Scaffold `packages/eslint`
- [x] `src/plugin.ts` — `createNodesV2` on `eslint.config.*` → cached `lint`, uncached `lint:fix`
- [x] `src/plugin.spec.ts` — inference, grouping, options, node_modules skip, determinism
- [x] `src/generators/init/` — generator + schema + spec
- [x] README.md + AGENTS.md
- [x] Dogfood: register in root `nx.json`, add to `release.projects`
- [x] Gates: test, build, lint, format, check:spec, openspec validate
