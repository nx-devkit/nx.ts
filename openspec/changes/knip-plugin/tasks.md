# Tasks: knip plugin

- [x] Scaffold `packages/knip` (package.json, tsdown, vitest, generators.json, tsconfig)
- [x] `src/plugin.ts` — `createNodesV2` on knip configs + `package.json["knip"]` → cached `knip`, uncached `knip:fix`
- [x] `src/plugin.spec.ts` — inference, grouping, precedence, options, node_modules skip, determinism
- [x] `src/generators/init/` — generator + schema + spec (JSONC-preserving registration)
- [x] README.md + AGENTS.md
- [x] Dogfood: register `./packages/knip/src/plugin.ts` in root `nx.json`
- [x] Gates: test, build, lint, format, check:spec, openspec validate
