# Tasks: commitlint-plugin

- [x] Scaffold `packages/commitlint/` (package.json, tsdown/vitest/tsconfig, generators.json)
- [x] Implement `src/plugin.ts` — cosmiconfig-order discovery, uncached `commitlint` target, `targetName`/`args` options
- [x] Specs: `plugin.spec.ts`, `generators/init/generator.spec.ts`
- [x] Init generator + schema.json
- [x] README.md + AGENTS.md
- [ ] Register in root `nx.json` + `release.projects`
- [ ] Gates: test, build, lint, format:check, check:spec, openspec validate
