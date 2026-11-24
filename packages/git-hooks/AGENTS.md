# @nx-devkit/git-hooks

Agent guide for working in `packages/git-hooks/`. Touch ONLY this directory unless the bead body says otherwise.

## What this package does

A `lefthook.y*ml`/`.lefthook.y*ml` or `.pre-commit-config.yaml` marks a
project whose git hooks are managed by lefthook or pre-commit. This
plugin turns each config into Nx targets so hooks run through `nx` — cached,
DAG-aware, `run-many`-able.

| Config                                 | Inferred target(s)                                                     |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `lefthook.yml`/`.yaml` (incl. dotfile) | `hooks:<hook-name>` per section + `hooks:install` (`lefthook install`) |
| `.pre-commit-config.yaml`              | `hooks:run` (`pre-commit run --all-files`) + `hooks:install`           |

## File layout

```text
packages/git-hooks/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — hook configs → hooks:* targets
│   ├── plugin.spec.ts
│   ├── lefthook-config.ts  # lefthook YAML → hook names (yaml pkg)
│   ├── lefthook-config.spec.ts
│   ├── types.ts            # NxDevkitGitHooksOptions
│   └── generators/init/    # register the plugin + optional lefthook peer
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitGitHooksOptions {
  targetPrefix?: string; // default "hooks" → hooks:install, hooks:run, hooks:<hook>
}
```

## Invariants

- Trigger glob is exactly
  `**/{lefthook.yml,lefthook.yaml,.lefthook.yml,.lefthook.yaml,.pre-commit-config.yaml}`.
- Configs group by owning directory; one target set per directory keyed on
  the lexically-first config file. The workspace-root dir is the root
  project (`root: ''`).
- Hook sections = top-level lefthook mappings minus known settings keys
  (`remote`, `remotes`, `extends`, `min_version`, `skip_output`,
  `skip_lfs`, `source_dir`, `source_dir_local`, `colors`, `no_tty`,
  `rc`, `output`, `execution`, `assert_lefthook_installed`,
  `glob_matcher`, `install_non_git_hooks`, `no_auto_install`,
  `templates`, `ai`, `lefthook` — mirrors the non-hook properties of the
  [lefthook schema](https://lefthook.dev/schema.json)). Scalar-valued or otherwise invalid
  section names land in `skipped` — never silently dropped.
- **Hook names are shell words.** `npx lefthook run <name>` interpolates
  the config key — only `[a-zA-Z0-9][a-zA-Z0-9._-]*` names become targets.
- Every inferred target is `cache: false` — hook verdicts depend on
  git state (`{staged_files}`, the index, repo-wide scans) that file
  inputs cannot hash, so a cached pass could go stale (same rule as
  the commitlint plugin). `hooks:install` also mutates `.git/hooks`.
  No `inputs` are declared — nothing is hashed.
- Fixed targets (`install`, `run`) are assigned after per-hook targets and
  win on a name collision.
- Both managers in one dir → `hooks:install` uses `commands: [...]` with
  `parallel: false`.
- A broken lefthook.yml warns and yields no hook targets, but
  `hooks:install` is still inferred (it does not depend on config content).
- `node_modules` and `..`-escaping directories are skipped; output is
  deterministic (sorted).
- `jsonc-parser` must stay a dependency — `@nx-devkit/internal` is bundled
  into the generator chunk and imports it (same fix as `a90b406`).

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
npx tsc --noEmit -p tsconfig.json
```
