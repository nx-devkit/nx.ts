# @nx-devkit/cspell

Zero-config Nx plugin: a [cspell](https://cspell.org/) config file in your workspace automatically produces a `spell` target — no `project.json` needed.

## Install

```bash
nx add @nx-devkit/cspell
```

The init generator registers the plugin in `nx.json`. Install the peer dependency yourself:

```bash
npm i -D cspell
```

## Usage

Any directory containing a cspell config gets a target on the owning project. When several config forms coexist in one directory, the first match in cspell's documented search order wins:

| Config file | Inferred target |
|---|---|
| `cspell` key in `package.json`, `cspell.json`, `.cspell.json`, `cspell.config.{json,js,cjs,mjs,ts}`, `cspell.{yaml,yml}`, `.cspell.{yaml,yml}` | `spell` |

```bash
nx run my-app:spell          # npx cspell lint .
nx run-many -t spell         # every project with a config
```

The target is **cached** — its verdict depends only on project file contents and the config.

## Options

Register with options in `nx.json`:

```jsonc
{
  "plugins": [
    {
      "plugin": "@nx-devkit/cspell",
      "options": {
        "targetName": "spell",        // default "spell"
        "args": "."                   // default "."
      }
    }
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `targetName` | `spell` | Target name. |
| `args` | `.` | Arguments passed to `cspell lint`, e.g. `"src/**/*.md"` or `"--words-only ."`. |

## License

MIT
