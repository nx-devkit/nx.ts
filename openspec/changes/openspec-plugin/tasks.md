# Tasks

| Task | Bead |
|---|---|
| Scaffold package + plugin.ts + spec | nx_ts-bqr |
| init generator + spec | nx_ts-bqr |
| README + AGENTS.md | nx_ts-bqr |
| Dogfood in root nx.json, run spec-validate | nx_ts-bqr |

- [x] proposal + spec delta
- [x] packages/openspec scaffold (package.json, tsdown, vitest, tsconfig, generators.json)
- [x] plugin.ts: createNodesV2 on `openspec/config.yaml` → `spec-validate` (+`spec-validate:<id>`)
- [x] init generator via registerPlugin
- [x] tests green, lint/format/spec-check/validate clean
- [x] README + AGENTS.md
- [x] register in root nx.json, verify `nx run <root>:spec-validate`
- [ ] PR + merge
