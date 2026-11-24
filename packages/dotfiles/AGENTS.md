# @nx-devkit/dotfiles

Agent guide for working in `packages/dotfiles/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/dotfiles/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entries: index, plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── index.ts            # re-exports createNodesV2 + options type
│   ├── types.ts            # NxDevkitDotfilesOptions (empty, reserved)
│   ├── plugin.ts           # createNodesV2 — chezmoi/dotbot markers → dotfiles:* targets
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Invariants

- Trigger glob is `**/{.chezmoiversion,install.conf.yaml,.install.conf.yaml}` only.
- Markers group by owning directory; one `dotfiles:*` target set per directory, lexically-first marker wins the result key.
- **chezmoi** — a dir with any `.chezmoi*` entry (matched `.chezmoiversion` or a sibling found on disk) gets `dotfiles:diff`, `dotfiles:apply`, `dotfiles:doctor` running `chezmoi diff|apply|doctor`.
- **dotbot** — a dir with `install.conf.yaml`/`.install.conf.yaml` gets `dotfiles:install`: `./install` when the launcher script exists, else `dotbot -c <basename>`.
- **stow** — deliberately not inferred in v1 (heuristic detection, no marker file); documented as future work.
- Every target has `cache: false` — each inspects or mutates the live home directory.
- `cwd` is `{projectRoot}`; chezmoi/dotbot auto-discover their config from it — never pass `--source`/`--config` beyond dotbot's `-c <basename>`.
- `node_modules` and `..`-escaping directories are skipped; output is deterministic (sorted).
- No peer dependencies — chezmoi/dotbot are system tools, not npm packages.

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
npx tsc --noEmit -p tsconfig.json   # tsdown does not typecheck
```
