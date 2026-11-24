# @nx-devkit/python

Agent guide for working in `packages/python/`. Touch ONLY this directory
unless the bead body says otherwise.

## What this package does

A `pyproject.toml` is the manifest of a Python project. This plugin turns
every `**/pyproject.toml` into an Nx project and infers targets for the
tools the file declares — never for tools it does not.

| pyproject.toml signal                      | Target      | Command               |
| ------------------------------------------ | ----------- | --------------------- |
| `[tool.pytest.*]` or `pytest` dep          | `test`      | `pytest`              |
| `[tool.ruff]` or `ruff` dep                | `lint`      | `ruff check`          |
| (gated identically to `lint`)              | `fmt`       | `ruff format --check` |
| `[tool.ty]` or `ty` dep                    | `typecheck` | `ty check`            |
| `[tool.pyright]`/`pyright` dep, no ty      | `typecheck` | `pyright`             |
| `[tool.uv]` or `uv.lock` (project or root) | `lock`      | `uv lock --check`     |
| `[tool.poetry]`                            | `lock`      | `poetry check`        |

Dependency lists scanned: `[project.dependencies]`,
`[project.optional-dependencies.*]`, `[dependency-groups.*]`,
`[tool.uv.dev-dependencies]`, `[tool.poetry.dependencies]`,
`[tool.poetry.dev-dependencies]`, `[tool.poetry.group.*.dependencies]`.
Names normalize per PEP 503 (`PyTest[cov]` → `pytest`); `python` in a
poetry table is the interpreter pin, not a dep.

## Runner detection

- `[tool.uv]` or `uv.lock` (project dir, then workspace root) → `uv run` prefix
- `[tool.poetry]` → `poetry run` prefix
- otherwise → no prefix

`lock` is the exception — `uv lock --check` / `poetry check` are manager
commands and never get the `uv run`/`poetry run` prefix.

## File layout

```text
packages/python/
├── package.json
├── tsdown.config.ts        # entries: index, plugin, generators/init
├── vitest.config.ts
├── tsconfig.json
├── generators.json         # @nx-devkit/python:init
├── src/
│   ├── index.ts            # re-exports createNodesV2 + helpers
│   ├── plugin.ts           # createNodesV2 — '**/pyproject.toml'
│   ├── plugin.spec.ts
│   ├── pyproject.ts        # TOML parse (smol-toml) + tool/dep detection
│   ├── targets.ts          # PyTools → TargetConfiguration map
│   ├── types.ts            # NxDevkitPythonOptions
│   └── generators/init/    # register the plugin (no npm peer deps)
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxDevkitPythonOptions {
  test?: boolean; // gate `test`, default true
  lint?: boolean; // gate `lint` + `fmt`, default true
  typecheck?: boolean; // gate `typecheck`, default true
  lock?: boolean; // gate `lock`, default true
}
```

## Invariants

- **Declaration gate.** A target exists only when the tool is declared —
  `[tool.<name>]` table or a dependency entry. A bare `[project]`-only
  pyproject still registers the project but gets zero targets.
- **`cache: true` on every target** including `lock` — all commands are
  deterministic over the declared inputs.
- **Inputs** per tool target: `{projectRoot}/pyproject.toml`,
  `{projectRoot}/**/*.py`, `{projectRoot}/pytest.ini`,
  `{projectRoot}/tox.ini`, `{projectRoot}/setup.cfg`,
  `{projectRoot}/**/conftest.py`, plus the standalone tool configs
  (`{projectRoot}/**/ruff.toml`, `.ruff.toml`, `pyrightconfig.json`,
  `ty.toml`) and the lock file (`{projectRoot}/uv.lock` or
  `{projectRoot}/poetry.lock`; `{workspaceRoot}/uv.lock` is also added
  for nested projects whenever a root `uv.lock` exists). The `lock`
  target hashes only the manifest and the lock file(s).
- **pytest ignores nested project roots** — `--ignore='<rel>'` for every
  Python project under `{projectRoot}` so `nx run-many -t test` does not
  collect the same tests twice.
- **A broken pyproject.toml must not break the project graph** — warn + skip.
- **No npm peer deps for Python tools** — the init generator registers
  the plugin only; pytest/ruff/ty/pyright are pip-managed.
- **`node_modules` and `..`-escaping directories are skipped**; the
  workspace root is not (single-package repos have a root pyproject).
- **Deterministic output** — config files are processed sorted.
- **Spec-check**: keep `'test'`/`'lint'`/`'typecheck'`/`'format'`/`'fmt'`
  string literals away from `createNodesV2`/`infer*Targets`/`testTarget`/
  `lintTarget`/`typecheckTarget` lines — `scripts/spec-check.ts` flags
  target keys duplicated across files.

## Gotchas

- smol-toml is the TOML parser (`parse()` throws on malformed input).
- `[tool.pytest]` counts as pytest-declared even without
  `[tool.pytest.ini_options]` — a subtable implies the parent table.
- `uv.lock` alone (no `[tool.uv]`) still selects the `uv` runner and the
  `uv lock --check` target.
- ty wins over pyright when both are configured.

## TDD workflow

1. Write failing specs (`src/**/*.spec.ts`, tmp dirs via `mkdtempSync`).
2. `bun run test` → RED.
3. Implement to GREEN.
4. `bun run build`.
5. `npx tsc --noEmit -p tsconfig.json` — tsdown does not typecheck.
6. Commit.

## Verification commands

```bash
cd packages/python
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```

## Scope rules

- Touch ONLY `packages/python/`.
- Do NOT modify other plugin packages or the root `nx.json` — dogfooding
  registration is a separate dedicated task.
