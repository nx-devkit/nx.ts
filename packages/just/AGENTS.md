# @nx-devkit/just

Agent guide for working in `packages/just/`. Touch ONLY this directory
unless the bead body says otherwise.

## What this package does

A justfile lists recipes (shell commands). This plugin turns every public
recipe into an Nx `just:<name>` target on the project that owns the
justfile — `just` stays the source of truth, Nx provides the graph.

| just concept                   | Nx concept                                      |
| ------------------------------ | ----------------------------------------------- |
| `name:` recipe                 | `<prefix>name` target (`just <name>`)           |
| `@name:` quiet recipe          | same as normal (still listed)                   |
| `_name:` or `[private]`        | skipped — just never lists them                 |
| `a: b c` prior deps            | `dependsOn: [{target}]` on same project         |
| `a: b && c` subsequent deps    | NOT mapped (Nx has no post-dep)                 |
| `(dep args)` dep               | dep name only; args not forwarded               |
| `mod foo` / `mod? foo`         | recurse into mod file → `foo::recipe` targets   |
| `mod foo 'path'`               | explicit path (file or dir containing mod file) |
| `alias a := b`                 | `<prefix>a` target running `just a`             |
| `set`/`import`/`export`/assign | skipped                                         |

## File layout

```text
packages/just/
├── package.json
├── tsdown.config.ts        # entries: index, plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── generators.json         # @nx-devkit/just:init
├── src/
│   ├── index.ts            # re-exports
│   ├── plugin.ts           # createNodesV2 — '**/{justfile,JUSTFILE,.justfile,just.just}'
│   ├── plugin.spec.ts
│   ├── justfile.ts         # line-wise justfile parser
│   ├── justfile.spec.ts
│   ├── types.ts            # NxDevkitJustOptions { targetPrefix?: string }
│   └── generators/init/    # register the plugin (no peer deps)
├── README.md
└── AGENTS.md
```

## Invariants

- **Col-0 only.** Recipe headers are only recognized at column 0 —
  indented lines are recipe bodies and are never parsed.
- **One justfile per dir.** When several names coexist (`justfile`,
  `JUSTFILE`, `.justfile`, `just.just`), just's own search preference
  wins (`justfile` > `just.just` > `Justfile` > `.justfile` > ...).
- **Commands never embed recipe params or args** — the command is always
  `just <name>` / `just <mod>::<name>`; users pass args via `nx run ... --`.
- **Never cached.** Recipes have arbitrary side effects; all targets are
  `cache: false`.
- **Mod resolution is bounded** — depth ≤ 4, canonical paths deduped.
  `mod?` missing sources skip silently; non-optional missing sources
  logDebug only.
- **No `just` peer dep.** `just` is a Rust binary, not on npm; init
  installs nothing.
- **`justfile` is always an input** (`{projectRoot}/<name>`), plus every
  resolved mod source file.
- **A broken justfile must not break the project graph** — warn + skip.
- `node_modules` and `..`-escaping directories are skipped; output order
  is deterministic (sorted).

## Extending

| Task                    | Where                             |
| ----------------------- | --------------------------------- |
| new header/dep syntax   | `justfile.ts`                     |
| mod file search order   | `plugin.ts` (`defaultModPaths`)   |
| target shape / metadata | `plugin.ts` (`buildTarget`)       |
| plugin options          | `types.ts` + `plugin.ts` callback |

## Scope rules

- Touch ONLY `packages/just/`.
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
cd packages/just
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```
