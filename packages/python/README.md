# @nx-devkit/python

Zero-config Nx plugin: every `pyproject.toml` becomes an Nx project, and only the tools the file actually declares get targets. No `project.json` required.

## Install

```bash
npm install -D @nx-devkit/python
bunx nx g @nx-devkit/python:init
```

The init generator registers the plugin in `nx.json`. Python tools (pytest, ruff, ty, pyright, uv, poetry) are not installed — add them with your Python package manager.

## Inferred targets

| Declared in pyproject.toml                          | Target      | Command               |
| --------------------------------------------------- | ----------- | --------------------- |
| `[tool.pytest.*]` or `pytest` in deps               | `test`      | `pytest`              |
| `[tool.ruff]` or `ruff` in deps                     | `lint`      | `ruff check`          |
| (same gate as `lint`)                               | `fmt`       | `ruff format --check` |
| `[tool.ty]` or `ty` dep                             | `typecheck` | `ty check`            |
| `[tool.pyright]` or `pyright` dep (only when no ty) | `typecheck` | `pyright`             |
| `[tool.uv]` or `uv.lock`                            | `lock`      | `uv lock --check`     |
| `[tool.poetry]`                                     | `lock`      | `poetry check`        |

Dependencies are read from `[project.dependencies]`, `[project.optional-dependencies.*]`, `[dependency-groups.*]`, `[tool.uv.dev-dependencies]`, `[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]`, and `[tool.poetry.group.*.dependencies]`. Names are normalized per PEP 503, so `PyTest[cov]` counts.

## Runner detection

Commands run with `cwd: {projectRoot}` and are prefixed by the project's manager:

| Signal                   | Command prefix |
| ------------------------ | -------------- |
| `[tool.uv]` or `uv.lock` | `uv run`       |
| `[tool.poetry]`          | `poetry run`   |
| neither                  | (none)         |

A workspace-root `uv.lock` marks nested projects as uv-managed too (uv workspaces keep one lock file at the root).

## Caching and inputs

Every inferred target is `cache: true` — pytest, ruff, ty, and pyright are deterministic over their inputs:

- `{projectRoot}/pyproject.toml`
- `{projectRoot}/**/*.py`
- `{projectRoot}/pytest.ini`, `tox.ini`, `setup.cfg`
- `{projectRoot}/**/conftest.py`
- standalone tool configs: `{projectRoot}/**/ruff.toml`, `.ruff.toml`, `pyrightconfig.json`, `ty.toml`
- the lock file (`uv.lock` / `poetry.lock`); in a uv workspace also the root `{workspaceRoot}/uv.lock`

The `lock` target hashes only the manifest and the lock file(s) — editing a `.py` source does not rerun `uv lock --check`.

pytest collects recursively, so a project's `test` target passes `--ignore` for every nested Python project — `nx run-many -t test` never runs the same test twice.

## Options

```jsonc
{
  "plugins": [
    {
      "plugin": "@nx-devkit/python",
      "options": {
        "test": true, // infer `test` when pytest is declared
        "lint": true, // infer `lint` + `fmt` when ruff is declared
        "typecheck": true, // infer `typecheck` when ty/pyright is declared
        "lock": true, // infer `lock` when uv or poetry is the manager
      },
    },
  ],
}
```

All four default to `true`. Set `lock: false` to manage locking outside Nx (e.g. in CI only).

## Behavior notes

- A broken `pyproject.toml` logs a warning and is skipped — it never breaks the project graph.
- `node_modules` and paths escaping the workspace are skipped.
- Credentials and environment travel through `process.env`; commands never carry secrets in argv.
