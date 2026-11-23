# Tasks: oxfmt-plugin

- [x] Scaffold `packages/oxfmt/` (package.json, tsdown/vitest/tsconfig,
      generators.json)
- [x] Implement `src/plugin.ts` — createNodesV2 over oxfmt's config search
      set → `format` (cache: false) + `format-check` (cache: true)
- [x] Implement the `init` generator — register the plugin, install the
      `oxfmt` peer dep
- [x] Specs: `plugin.spec.ts`, `generators/init/generator.spec.ts`
- [x] README.md + AGENTS.md
- [x] Preset: `oxfmt` option, `OXFMT_CONFIG_NAMES`, `inferOxfmtTargets`,
      format precedence over biome, root-config fallback inputs
- [x] Preset init generator: detect oxfmt configs, install `oxfmt`, report
      format targets in the summary
- [x] Preset specs for oxfmt delegation + precedence
- [x] Gates: test, build, lint, check:spec, openspec validate
