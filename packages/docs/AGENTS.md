# @nx-devkit/docs

Agent guide for working in `packages/docs/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/docs/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — .vitepress/config.* / astro.config.* → docs:* targets
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDocsPluginOptions {
  targetPrefix?: string; // default "docs" → docs:dev, docs:build, docs:preview
}
```

## Invariants

- Trigger glob is `**/{.vitepress/config,astro.config}.{ts,js,mts,mjs,cjs,cts}` — matched files group by owning project root, one target set per project.
- `.vitepress/config.*` maps to the PARENT of `.vitepress` (`docs/.vitepress/config.ts` → `docs`; `.vitepress/config.ts` → workspace root project).
- `astro.config.*` wins over `.vitepress/config.*` in the same project root — the target names would collide.
- `docs:dev` and `docs:preview` are `continuous: true` and never cached; `docs:preview` `dependsOn` `<prefix>:build`.
- `docs:build` is the only cached target. Outputs: `{projectRoot}/.vitepress/dist` + `{projectRoot}/dist` (vitepress), `{projectRoot}/dist` (astro), plus a literal `outDir: '…'` sniffed from the config (`sniffOutDir`); the sniffed dir is also negated from inputs.
- Build inputs cover `{projectRoot}/**/*`, `.vitepress/**/*` (dot-dir — `**/*` does not reach it), and every matched config file; `dist`, `.vitepress/dist`, `.vitepress/cache`, `.astro`, `node_modules` are negated so prior outputs never poison the hash.
- Starlight = astro config containing `@astrojs/starlight` / `starlight(` — same `astro` CLI, reported via `metadata.technologies: ['astro', 'starlight']`.
- Commands run `npx vitepress|astro <cmd>` with `cwd: '{projectRoot}'` — both tools auto-discover their config; never pass `--config`.
- `node_modules` and `..`-escaping roots are skipped; the workspace-root project IS supported (`{workspaceRoot}` tokens).
- `jsonc-parser` must stay a dependency — `@nx-devkit/internal` is bundled into the generator chunk and imports it (same fix as `a90b406`).
- The init generator installs only the peers whose configs it finds (`vitepress` for `.vitepress/config.*`, `astro` for `astro.config.*`).

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
```
