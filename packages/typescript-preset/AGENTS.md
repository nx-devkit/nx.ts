# @nx-devkit/typescript (preset)

Agent guide for working in `packages/typescript-preset/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```
packages/typescript-preset/
├── package.json
├── tsdown.config.ts          # entry: src/plugin.ts
├── vitest.config.ts
├── src/
│   ├── plugin.ts             # createNodesV2 — tsconfig.json + vitest.config.* → `typecheck`, `test`, `test:watch`, `test:coverage`
│   └── plugin.spec.ts        # (under test/ — see note below)
├── test/
│   └── plugin.spec.ts        # canonical test location
├── README.md
└── AGENTS.md
```

> Note: this package places its test under `test/` (not `src/`) historically. The `vitest.config.ts` glob is `test/**/*.spec.ts`. Do not move the test file without updating `vitest.config.ts`.

## Standard options interface

```ts
export interface NxTypecheckPluginOptions {
  /** Use the experimental `@typescript/native-preview` (`tsgo`) binary. Default: true. */
  tsgo?: boolean;
  /** Name of the tsconfig file to detect. Default: "tsconfig.json". */
  configFile?: string;
  /** Pre-clean the tsbuildinfo before building. Default: false. */
  clean?: boolean;
}
```

## Scope rules

- Touch ONLY `packages/typescript-preset/`.
- Reusable helpers (`inferTypecheckTarget`, `inferVitestTargets`, `shouldSkipPath`, `logDebug`, `isVerbose`) are exported for sibling plugins. Do NOT duplicate them elsewhere.
- Do NOT modify other plugin packages or the root `nx.json`.

## TDD workflow

1. Write failing `test/plugin.spec.ts` covering: workspace-root skip, tsconfig detection, vitest target inference, options (`tsgo`, `configFile`, `clean`).
2. `bun test` → RED.
3. Update `src/plugin.ts`.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/typescript-preset
bun test
bun run build
```