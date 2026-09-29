# @nx-devkit/commitlint

Zero-config Nx plugin: a [commitlint](https://commitlint.js.org/) config file in your workspace automatically produces a `commitlint` target — no `project.json` needed.

## Install

```bash
nx add @nx-devkit/commitlint
```

The init generator registers the plugin in `nx.json` and installs the missing peer dependency (`@commitlint/cli`) into devDependencies.

## Usage

Any directory containing a commitlint config gets a target on the owning project. When several config forms coexist in one directory, the first match in [cosmiconfig's search order](https://github.com/cosmiconfig/cosmiconfig#usage) wins:

| Config file | Inferred target |
|---|---|
| `commitlint` key in `package.json`, `.commitlintrc*` (`.json`/`.yaml`/`.yml`/`.js`/`.ts`/`.mjs`/`.cjs`/`.cts`), `commitlint.config.{js,ts,mjs,cjs,cts}` | `commitlint` |

```bash
nx run my-app:commitlint          # npx commitlint --last
nx run-many -t commitlint         # every project with a config
```

The target is **not cached** — its verdict depends on git history (`--last`, `--from`/`--to`), which file inputs cannot capture.

## Options

Register with options in `nx.json`:

```jsonc
{
  "plugins": [
    {
      "plugin": "@nx-devkit/commitlint",
      "options": {
        "targetName": "commitlint",   // default "commitlint"
        "args": "--last"              // default "--last"
      }
    }
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `targetName` | `commitlint` | Target name. |
| `args` | `--last` | Arguments passed to `commitlint`. Examples: `--edit .git/COMMIT_EDITMSG` (commit-msg hook), `--from origin/main` (CI range). |

## License

MIT
