# Tasks: playwright plugin

- [x] Scaffold `packages/playwright`
- [x] `src/plugin.ts` — `createNodesV2` on `playwright.config.*` → `e2e`, `e2e:ui`, `e2e:update-snapshots`
- [x] `src/plugin.spec.ts` — inference, grouping, options, node_modules skip, determinism
- [x] `src/generators/init/` — generator + schema + spec
- [x] README.md + AGENTS.md
- [x] Dogfood: register in root `nx.json`, add to `release.projects`
- [x] Gates: test, build, lint, format, check:spec, openspec validate
