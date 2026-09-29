# Proposal: @nx-devkit/openspec plugin

## Why

The workspace validates OpenSpec changes via `bun run spec:validate`, a plain
package.json script. Every consumer keeping `openspec/` gets no Nx target.
A dedicated plugin turns spec validation into cached, atomized targets:
the aggregate run validates everything once, and per-change targets re-validate
only the change directory that was edited.

## What changes

- New package `packages/openspec` (`@nx-devkit/openspec`).
- `createNodesV2` triggers on `**/openspec/config.yaml`.
- Owning project (workspace root included) gets a cached `spec-validate`
  target running `openspec validate --all --strict` (via `nx:run-commands`,
  cwd = `{projectRoot}`).
- Per active change directory (`openspec/changes/<id>/` containing
  `proposal.md`, `archive/` excluded): `spec-validate:<id>` running
  `openspec validate '<id>' --strict`, inputs scoped to that change dir.
- Options: `targetName`, `perChange` (default true), `strict` (default true).
- Standard `init` generator (`nx add @nx-devkit/openspec`).
- Dogfooding: registered in root `nx.json`, replacing `bun run spec:validate`
  usage with the inferred target.

## Non-goals

- No `openspec list`/`show`/`archive` targets — validate is the CI-meaningful op.
- No per-spec atomization (specs are validated by the aggregate target).
