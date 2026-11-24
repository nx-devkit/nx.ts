# @nx-devkit/ci-lint

Agent guide for working in `packages/ci-lint/`. Touch ONLY this directory unless the bead body says otherwise.

## Scope rules

- Touch ONLY `packages/ci-lint/`.
- Do NOT modify other plugin packages or the root `nx.json` — except adding `packages/ci-lint` to `release.projects` when the bead covers package onboarding.

## File layout

```text
packages/ci-lint/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — `.github/workflows/*.{yml,yaml}` → `lint-ci` on root project
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Standard options interface

```ts
export interface NxCiLintPluginOptions {
  targetName?: string; // default "lint-ci"
  actionlint?: boolean; // default true
  zizmor?: boolean; // default true
  actionlintArgs?: string; // default ""
  zizmorArgs?: string; // default ""
  zizmorFormat?: 'plain' | 'json' | 'sarif'; // default "plain"
  zizmorOutput?: string; // redirect path for zizmor output (SARIF upload)
}
```

## Invariants

- Trigger glob is the anchored `.github/workflows/*.{yml,yaml}` — workflows are repo-wide, so the target lands on the root project (`.`); nested `.github/workflows/` dirs are ignored.
- Both tools are optional: each leg probes the tool on PATH (`command -v` on POSIX, `where` on cmd.exe) and echoes a skip when missing. Legs never short-circuit — a failed run flips `ci_lint_failed` and the trailing `exit`/`if defined` check fails the target after all legs ran.
- Both tools are PATH-only: `zizmor` is not on npm (pipx/cargo/brew), and npm's `actionlint` is a WASM API without a CLI bin — the init generator installs neither; the checklist points at brew/go/scoop.
- Setting `actionlint: false` and `zizmor: false` together infers NO target.
- Bare `actionlint` (no args) scans `.github/workflows/` from `cwd` = `{projectRoot}` = workspace root; zizmor gets the dir explicitly.
- The target is `cache: true`; inputs cover the workflow glob plus `.github/actionlint.{yml,yaml}` and `.github/zizmor.{yml,yaml}` + `zizmor.{yml,yaml}` configs, plus a `{runtime}` input per enabled tool hashing its `--version` output so installing/upgrading a tool busts the cache.
- No `lint-ci:fix` target — actionlint findings are rarely auto-fixable (deferred per issue #226).
- All interpolated values go through `q()` — POSIX single-quote escaping, cmd.exe double-quote on Windows (`"`/`%`/`!`/control chars throw — they cannot be quoted safely). `*Args` strings are whitespace-split first, then quoted per token.

## TDD workflow

1. Write failing specs in `plugin.spec.ts` (tmp dirs via `mkdtempSync`).
2. `bun run test` → RED.
3. Implement to GREEN.
4. `bun run build`.
5. Commit.

## Verification commands

```bash
cd packages/ci-lint
bun run test
bun run build
```
