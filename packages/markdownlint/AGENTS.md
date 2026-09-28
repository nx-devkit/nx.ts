# @nx-devkit/markdownlint

Agent guide for working in `packages/markdownlint/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/markdownlint/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — `.markdownlint*` → `lint-md`/`lint-md:fix`
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Invariants

- Configs grouped by owning directory — a directory with both `.markdownlint.*`
  and `.markdownlint-cli2.*` gets ONE `lint-md`/`lint-md:fix` pair.
- `--config` is emitted ONLY for `.markdownlint.*` rules configs.
  `.markdownlint-cli2.*` files hold cli2 options (globs/gitignore/frontMatter)
  and are auto-discovered — passing them to `--config` breaks rules parsing.
- Commands carry `'#**/node_modules/**'` negation by default (`ignoreGlobs`
  option); markdownlint-cli2 does NOT honor `.markdownlintignore` (removed in
  cli2; use `gitignore: true` in `.markdownlint-cli2.jsonc` instead).
- Inputs must start with `{workspaceRoot}` or `{projectRoot}` — bare `**/*.md`
  is an invalid Nx fileset. All config files in the directory are inputs.
- The workspace-root config IS a valid owner (repo-wide lint is the primary
  use). `node_modules` and `..`-escaping configs are skipped.
- `lint-md:fix` is never cached.
- Commands run with `cwd` = `{projectRoot}` (the config's own directory) so
  nested `.markdownlint-cli2.*` runner configs auto-discover; `--config`
  args use basenames. All interpolated values go through `sq()` POSIX
  single-quote escaping. `configFiles` are sorted before grouping for
  deterministic output order.

## TDD workflow

1. Write failing `src/plugin.spec.ts` covering: root config, project config,
   cli2-vs-rules config distinction, node_modules skip, `fixTargetName: false`.
2. `bun run test` → RED → implement → GREEN.
3. `bun run build`.
4. Commit.

## Verification commands

```bash
cd packages/markdownlint
bun run test
bun run build
```
