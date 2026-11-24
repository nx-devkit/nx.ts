# @nx-devkit/cargo

Agent guide for working in `packages/cargo/`. Touch ONLY this directory
unless the bead body says otherwise.

## What this package does

A `Cargo.toml` describes a crate or a cargo workspace. This plugin turns
every `[package]` manifest into an Nx project named after the package
with `cargo -p` targets (`build`, `test`, `clippy`, `fmt`), and every
virtual `[workspace]` manifest into a project with workspace-level
`cargo build`/`cargo test` (no `-p`).

| cargo concept                     | Nx concept                                   |
| --------------------------------- | -------------------------------------------- |
| `[package]` manifest              | project, `name` = package.name               |
| `[workspace]` + `[package]`       | crate project (root package of a workspace)  |
| `[workspace]` without `[package]` | virtual-root project, ws-level build/test    |
| `members` / `exclude` globs       | lockfile owner + virtual-root target inputs  |
| `dep = { path = "…" }`            | `implicitDependencies` edge                  |
| `dep = { workspace = true }`      | resolved via `[workspace.dependencies]` path |

## File layout

```text
packages/cargo/
├── package.json
├── tsdown.config.ts        # entries: index, plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── generators.json         # @nx-devkit/cargo:init
├── src/
│   ├── index.ts            # re-exports createNodesV2 + helpers
│   ├── plugin.ts           # createNodesV2 — '**/Cargo.toml'
│   ├── plugin.spec.ts
│   ├── cargo-toml.ts       # smol-toml parse → CargoManifest
│   ├── workspace.ts        # member glob expansion, lockfile + path deps
│   ├── workspace.spec.ts
│   ├── targets.ts          # crate/ws → TargetConfiguration
│   ├── types.ts            # NxDevkitCargoOptions { clippy?, fmt? }
│   └── generators/init/    # register the plugin (no peer deps — cargo is a system toolchain)
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitCargoOptions {
  clippy?: boolean; // default true
  fmt?: boolean; // default true
}
```

## Invariants

- **Every manifest node emits only its own project.** A member crate's
  Cargo.toml emits its own `-p` targets; the workspace root's node emits
  the root project. `members` globs are used for lockfile-root
  resolution and virtual-root inputs, not for project emission.
- **`cwd` is `{projectRoot}`** — cargo walks up to the owning workspace
  root itself, so `-p` works for members and standalone crates alike.
- **All targets `cache: true`, `outputs: []`** — cargo builds are
  deterministic per inputs; real artifacts live in the shared `target/`
  dir which is never a project output.
- **Inputs per crate:** `{projectRoot}/Cargo.toml`, `src/**/*`,
  `build.rs`, and the owning workspace's `Cargo.lock` (`{projectRoot}`
  for standalone crates, `{workspaceRoot}/<ws>/Cargo.lock` for members).
- **A broken Cargo.toml must not break the project graph** — warn + skip.
- **`node_modules` and `..`-escaping dirs are skipped**; a `path` dep
  resolving above the workspace root is skipped with a debug log.
- **smol-toml parses; we narrow.** `parseCargoToml` throws on invalid
  TOML — the caller catches, warns, skips.
- **No cargo peer dep.** Cargo is a system toolchain; the init generator
  registers the plugin and installs nothing.
- `jsonc-parser` must stay a dependency — `@nx-devkit/internal` is
  bundled into the generator chunk and imports it.

## Gotchas

- The crate's lockfile lives at its **cargo workspace root**, which may
  differ from the Nx workspace root (`resolveLockfileRoot` walks
  ancestors for the nearest claiming `[workspace]` manifest; `exclude`d
  crates lock in their own dir).
- `members` glob expansion walks the filesystem under the ws root —
  `node_modules`, `target`, and dot-dirs are never descended into.
- `target.<cfg>.dependencies` tables count for `implicitDependencies` —
  platform-specific path deps are still edges.

## Extending

| Task                     | Where                                  |
| ------------------------ | -------------------------------------- |
| new dep-table field      | `cargo-toml.ts` (`collectDepTable`)    |
| member/exclude semantics | `workspace.ts` (`expandMembers`)       |
| lockfile ownership       | `workspace.ts` (`resolveLockfileRoot`) |
| new inferred target      | `targets.ts` (`buildCrateTargets`)     |
| plugin options           | `types.ts` + `plugin.ts` callback      |

## Scope rules

- Touch ONLY `packages/cargo/`.
- Do NOT modify other plugin packages or the root `nx.json` — dogfooding
  registration is a separate dedicated task.

## TDD workflow

1. Write failing specs (`src/**/*.spec.ts`, tmp dirs via `mkdtempSync`).
2. `bun run test` → RED.
3. Implement to GREEN.
4. `bun run build`.
5. `npx tsc --noEmit -p tsconfig.json` — tsdown does not typecheck.
6. Commit.

## Verification commands

```bash
cd packages/cargo
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```
