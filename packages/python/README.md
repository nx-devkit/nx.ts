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

Dependencies are read from `[project.dependencies]`, `[project.optional-dependencies.*]`, `[dependency-groups.*]`, `[tool.uv.dev-dependencies]`, and all `[tool.poetry.*dependencies]` tables. Names are normalized per PEP 503, so `PyTest[cov]` counts.

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
- `{projectRoot}/pytest.ini`
- `{projectRoot}/**/conftest.py`
- the lock file (`uv.lock` / `poetry.lock`)

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
      },
    },
  ],
}
```

All three default to `true`. The `lock` target has no gate — it follows the detected package manager.

## Behavior notes

- A broken `pyproject.toml` logs a warning and is skipped — it never breaks the project graph.
- `node_modules` and paths escaping the workspace are skipped.
- Credentials and environment travel through `process.env`; commands never carry secrets in argv.
