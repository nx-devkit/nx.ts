# @nx-devkit/git-hooks

Standalone Nx plugin: lefthook and pre-commit configs become `hooks:*` targets on the owning project — `hooks:install`, `hooks:run`, and one `hooks:<name>` per lefthook hook section. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/git-hooks lefthook   # lefthook users
pip install pre-commit                     # pre-commit users (Python tool)
```

Depends on `@nx/devkit` `^24`. `lefthook` `^1 || ^2` is an optional peer — pre-commit is a Python tool and is never installed via npm.

## Register

```bash
nx add @nx-devkit/git-hooks   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/git-hooks"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                                               | Target          | Command                      | Cacheable |
| ----------------------------------------------------- | --------------- | ---------------------------- | --------- |
| `lefthook.y*ml` / `.lefthook.y*ml` — per hook section | `hooks:<name>`  | `npx lefthook run <name>`    | no        |
| `lefthook.y*ml` / `.lefthook.y*ml`                    | `hooks:install` | `npx lefthook install`       | no        |
| `.pre-commit-config.yaml`                             | `hooks:run`     | `pre-commit run --all-files` | no        |
| `.pre-commit-config.yaml`                             | `hooks:install` | `pre-commit install`         | no        |

A lefthook config's hook sections are its top-level mappings (`pre-commit:`,
`pre-push:`, `commit-msg:`, custom names…) — known lefthook settings
(`remote`, `extends`, `min_version`, `skip_output`, `source_dir`, …) are
never turned into targets. A section named `install` always loses to the
fixed `hooks:install`; a section named `run` loses to `hooks:run` only
when a `.pre-commit-config.yaml` sits in the same directory.

When a directory has both a lefthook and a pre-commit config, the target
set merges and `hooks:install` installs both hook managers (sequentially).

No hook target is cached: a hook's verdict depends on git state
(`{staged_files}`, the index, repo-wide scans) that file inputs cannot
hash, so a cached pass could silently go stale.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/git-hooks",
      "options": { "targetPrefix": "githooks" },
    },
  ],
}
```

| Option         | Default   | Description                                                                      |
| -------------- | --------- | -------------------------------------------------------------------------------- |
| `targetPrefix` | `"hooks"` | Target name prefix → `<prefix>:install`, `<prefix>:run`, `<prefix>:<hook-name>`. |

## Inspect

```bash
npx nx show project my-app                    # see inferred targets
npx nx run my-app:hooks:install               # write the git hook shims
npx nx run my-app:hooks:pre-commit            # run one lefthook hook
npx nx run my-app:hooks:run                   # run pre-commit on all files
npx nx run-many -t hooks:install              # install hooks in every package
```
