# Tasks: go-plugin

- [x] Scaffold `packages/go/` (package.json, tsdown/vitest/tsconfig,
      generators.json)
- [x] Implement `src/gowork.ts` — go.work `use` parser (single-line,
      block, comments, quoted paths; other directive blocks ignored)
- [x] Implement `src/targets.ts` — module dir → build/test/vet/lint
      targets (cwd, cache, inputs, golangci config detection)
- [x] Implement `src/plugin.ts` — `createNodesV2` on
      `**/{go.work,go.mod}`: go.work claims use dirs, unclaimed go.mod
      dirs go standalone, skip rules
- [x] Implement `src/types.ts` — `NxDevkitGoOptions { lint?: boolean }`
- [x] Implement the `init` generator — register the plugin (no peer deps)
- [x] Specs: `gowork.spec.ts`, `targets.spec.ts`, `plugin.spec.ts`,
      `generators/init/generator.spec.ts`
- [x] README.md + AGENTS.md
- [ ] Gates: test, build, lint, format:check, check:spec,
      openspec validate
