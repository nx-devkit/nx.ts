# @nx-devkit/bazel

Agent guide for working in `packages/bazel/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/bazel/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entries: index, plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── index.ts            # re-exports createNodesV2 + types
│   ├── types.ts            # NxDevkitBazelOptions { targetPrefix? }
│   ├── plugin.ts           # createNodesV2 — BUILD files → bazel:* targets
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitBazelOptions {
  targetPrefix?: string; // default "bazel" → bazel:build, bazel:test
}
```

## Invariants

- Trigger glob is `**/{BUILD,BUILD.bazel,WORKSPACE,WORKSPACE.bazel,MODULE.bazel}`.
  Only `BUILD`/`BUILD.bazel` files create projects; `WORKSPACE*`/`MODULE.bazel`
  are workspace markers and re-trigger inference.
- One project per directory holding a BUILD file; name is the dir's
  package.json `name` when present, else `bazel:<relpath>` (`bazel` at root).
- `<pkg>` in `bazel build //<pkg>:all` is relative to the nearest ancestor
  dir containing a workspace marker (disk check); falls back to the nx
  workspace root → root BUILD gives `//:all`.
- `bazel:test` exists only when a BUILD file matches `\b\w*_test\s*\(` —
  a regex scan, not BUILD parsing. No `bazel query`, no deps edges, no
  per-rule targets: this is a mixed-repo bridge.
- Both targets are `cache: false` — Bazel owns `bazel-*` symlinks into
  output_user_root; Nx can capture/restore nothing, so a cache hit would
  skip the build and leave no output tree. Bazel's own cache does the
  deduping; inputs still drive `nx affected`.
- Inputs: `{projectRoot}/**` minus the exact Bazel output symlinks
  (`bazel-bin`/`bazel-out`/`bazel-testlogs`/`bazel-<basename>`, dir + `/**`
  — a legit `bazel-*` source dir stays hashed), the dir's BUILD files,
  every ancestor workspace marker, and `{workspaceRoot}/**/*.bzl` (shared
  macros re-hash every target).
- `cwd` is always `{projectRoot}` — Bazel finds its workspace root upward.
- `node_modules` and `..`-escaping dirs are skipped; output is sorted/deterministic.
- `jsonc-parser` must stay a dependency — `@nx-devkit/internal` is bundled
  into the generator chunk and imports it.
- Bazel has no npm peer dep — the init generator registers the plugin and
  installs nothing.

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
npx tsc --noEmit -p tsconfig.json   # tsdown does not typecheck
```
