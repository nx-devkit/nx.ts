# @nx-devkit/knip

Agent guide for working in `packages/knip/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/knip/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — knip configs → `knip`/`knip:fix`
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Invariants

- Trigger glob covers standalone knip configs AND `package.json`; a `package.json` infers a target only when it contains a `"knip"` key (checked by reading the file — `hasKnipKey`).
- Configs are grouped by owning directory — several config forms in one dir produce ONE `knip`/`knip:fix` pair; precedence follows knip's own discovery order (`knip.json` first).
- The command is always bare `npx knip` — knip auto-discovers its config from `cwd`; never pass `--config`.
- `cwd` is `{projectRoot}` (the config's own directory), so nested projects analyze themselves, not the workspace.
- Inputs start with `{workspaceRoot}` (root project, dir `""`) or `{projectRoot}`; every knip-bearing file in the directory is an input so edits bust the cache.
- `knip:fix` (`npx knip --fix`) is never cached.
- `node_modules` and `..`-escaping directories are skipped (`shouldSkipDir`).
- Output ordering is deterministic: files and directories are sorted before inference.

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
```
