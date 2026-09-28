# @nx-devkit/openspec

Agent guide for working in `packages/openspec/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/openspec/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — openspec/config.yaml → spec-validate (+:<id>)
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Invariants

- Owning project = directory containing `openspec/` — for `openspec/config.yaml`
  at root the project root is `''` (root project is a valid owner).
- Per-change targets are discovered by fs-scanning `openspec/changes/` for dirs
  containing `proposal.md` at inference time; `archive/` is excluded.
- Change ids go through `sq()` POSIX single-quote escaping into the command.
- Inputs must be valid Nx filesets (`{workspaceRoot}`/`{projectRoot}` prefixed).
- `configFiles` are sorted before processing for deterministic output order.

## TDD workflow

1. Write failing `src/plugin.spec.ts` — uses real tmpdirs (listChangeIds reads fs).
2. `bun run test` → RED → implement → GREEN.
3. `bun run build`.
4. Commit.

## Verification commands

```bash
cd packages/openspec
bun run test
bun run build
```
