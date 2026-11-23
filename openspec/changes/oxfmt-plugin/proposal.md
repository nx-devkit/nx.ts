# Proposal: oxfmt-plugin

## Why

Completes the oxc toolchain story (oxlint, tsdown already covered): a
committed `.oxfmtrc.*`/`oxfmt.config.*` should infer cached `format` /
`format-check` targets without a `project.json`. No native Nx oxfmt plugin
exists; today the preset offers formatting only via biome.

## What changes

- New package `@nx-devkit/oxfmt` under `packages/oxfmt/`.
- `createNodesV2` watches oxfmt's own search set:
  `**/{.oxfmtrc.json,.oxfmtrc.jsonc,oxfmt.config.ts,oxfmt.config.mts}` — the
  names oxfmt auto-discovers when walking up from a formatted file
  (`.js`/`.cjs`/`.cts` configs load only via `oxfmt -c`, never by search;
  there is no `package.json` key).
- A matched config's directory becomes a project with:
  - `format` — `oxfmt --write .`, `cache: false` (mutates source)
  - `format-check` — `oxfmt --check .`, `cache: true`
- Workspace-root configs are skipped (nested project roots only, same rule
  as `@nx-devkit/biome`); one config per directory — first glob hit wins.
- New generator `@nx-devkit/oxfmt:init` registers the plugin in `nx.json`
  and installs the `oxfmt` peer dependency.
- `typescript-preset`: new `oxfmt?: boolean` option (default `true`).
  `.oxfmtrc.*`/`oxfmt.config.*` infers `format`/`format-check` and wins over
  biome — the same precedence direction as lint (oxc tool beats biome).
  A workspace-root oxfmt config is a fallback for every project and is added
  to the format targets' cache inputs.
- Preset `init` generator detects oxfmt configs, reports format targets,
  and installs `oxfmt` when absent.

## Non-goals

- No dogfooding registration in the root `nx.json` — a dedicated task owns
  that.
- No lint target — oxfmt formats only.
- No prettier/biome migration (`oxfmt --migrate`) support.
