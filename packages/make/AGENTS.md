# @nx-devkit/make

Agent guide for working in `packages/make/`. Touch ONLY this directory unless the bead body says otherwise.

## What this package does

A `Makefile` describes a goal graph. The plugin turns every rule header
(`name: prerequisites`) and every `.PHONY` declaration into an Nx target
`make:<name>` that runs `make -C <dir> <name>` via `nx:run-commands` —
so a consumer drops the plugin into a repo with existing Makefiles and
keeps them as the source of truth.

| Makefile construct           | Nx concept                                      |
| ---------------------------- | ----------------------------------------------- |
| `name: prereqs`              | `make:<name>` target                            |
| `.PHONY: a b`                | `make:a`, `make:b` (even with no rule)          |
| prereq that is itself a rule | `{ target: 'make:<prereq>', projects: 'self' }` |
| `%.o:`, `t: %p: %r`          | skipped — pattern / static pattern rules        |
| `name::`, `a b &:`           | skipped — double-colon / grouped edge cases     |
| `_name:`                     | skipped — internal helper convention            |
| `.SILENT:` etc (`^\.[A-Z]`)  | skipped — GNU make special targets              |
| `VAR := x`                   | skipped — assignment, not a rule                |

## File layout

```text
packages/make/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — '**/Makefile' → make:* targets
│   ├── plugin.spec.ts
│   ├── makefile.ts         # rule/.PHONY parser (not a make evaluator)
│   ├── makefile.spec.ts
│   ├── types.ts            # NxDevkitMakeOptions { targetPrefix?, cache? }
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitMakeOptions {
  targetPrefix?: string; // default "make" → make:<name>
  cache?: boolean; // default false — opt-in, Makefiles lack a file-output signal
}
```

## Invariants

- Trigger glob is `**/Makefile` only — `makefile`, `GNUmakefile`, `*.mk`
  are out of scope.
- One target set per directory owning a Makefile; the workspace-root
  Makefile maps to the root project (`root: ''`).
- Command is always `make -C <dir> <name>` (`-C .` at the root);
  `nx:run-commands` defaults cwd to the workspace root. Recipe text
  NEVER appears in the command — make reads the Makefile itself.
- `dependsOn` only references emitted targets — a prereq whose rule was
  skipped (pattern, `_`-internal, special) is filtered out.
- `cache: false` is the default; `.PHONY` does not decide cacheability.
- `node_modules` and `..`-escaping directories are skipped; output is
  deterministic (config files sorted, targets in declaration order).
- The parser is line-oriented and never throws — an unreadable Makefile
  warns and is skipped; a Makefile with zero inferable goals emits no
  project.
- `jsonc-parser` must stay a dependency — `@nx-devkit/internal` is
  bundled into the generator chunk and imports it.
- No `make` peer dep — make is a system binary on PATH; the init
  generator installs nothing.

## Gotchas

- `FOO := bar` matches the rule regex shape (`name` + `:`) — the parser
  rejects it by checking the char after `:` is not `=`.
- A `:` inside the prerequisite section means a static pattern rule —
  the whole rule is skipped.
- Backslash line continuations are joined before parsing, so a rule
  split over lines reads as one.

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
npx tsc --noEmit -p tsconfig.json
```
