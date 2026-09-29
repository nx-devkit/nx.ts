# Tasks

| Task | Bead |
|---|---|
| Scaffold package + plugin.ts + spec | nx_ts-034 |
| init generator + spec | nx_ts-034 |
| README + AGENTS.md | nx_ts-034 |
| Dogfood in root nx.json, run lint-md | nx_ts-034 |
| Release onboarding (prepare-for-release + trust) | nx_ts-034 |

- [x] proposal + spec delta
- [x] packages/markdownlint scaffold (package.json, tsdown, vitest, tsconfig, generators.json)
- [x] plugin.ts: createNodesV2 on `.markdownlint*` configs → `lint-md` (+`lint-md:fix`)
- [x] init generator via registerPlugin
- [x] tests green, lint/format/spec-check/validate clean
- [x] README + AGENTS.md
- [x] register in root nx.json, verify `nx run <root>:lint-md`
- [x] PR + merge
