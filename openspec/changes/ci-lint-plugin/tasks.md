# Tasks: ci-lint-plugin

- [x] Scaffold `packages/ci-lint/` (package.json, tsdown/vitest/tsconfig, generators.json)
- [x] Implement `src/plugin.ts` — root `.github/workflows` discovery, cached `lint-ci` target, tool options
- [x] Specs: `plugin.spec.ts`, `generators/init/generator.spec.ts`
- [x] Init generator + schema.json (registers plugin; tools stay PATH-only — no npm installs)
- [x] README.md + AGENTS.md
- [x] Register `packages/ci-lint` in `release.projects`
- [x] Gates: test, build, lint, format:check, check:spec, openspec validate
- [ ] Register plugin in root `nx.json` `plugins[]` — separate dogfooding task
