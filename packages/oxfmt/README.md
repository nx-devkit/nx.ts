# @nx-devkit/oxfmt

Standalone Nx plugin: any nested `.oxfmtrc.json`, `.oxfmtrc.jsonc`, `oxfmt.config.ts`, or `oxfmt.config.mts` becomes a project with `format` and `format-check` targets. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts). If you want the full TypeScript toolchain (typecheck, test, lint, format, build), use the [`@nx-devkit/typescript`](../typescript-preset/README.md) preset instead — it includes everything this plugin does.

## Install

```bash
bun add -D @nx-devkit/oxfmt oxfmt
```

Depends on `@nx/devkit` `^24` (installed automatically — `nx` itself comes from your workspace via devkit's peer range). Requires the `oxfmt` peer.

## Register

```bash
nx add @nx-devkit/oxfmt   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/oxfmt"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts infer* targets -->

| Target         | Default command   | Cacheable           | Inputs                          |
| -------------- | ----------------- | ------------------- | ------------------------------- |
| `format`       | `oxfmt --write .` | no (mutates source) | the matched config file, `**/*` |
| `format-check` | `oxfmt --check .` | yes                 | the matched config file, `**/*` |

All run via `nx:run-commands` with `cwd` = the project root.

## Inspect

```bash
npx nx show projects
npx nx show project <name>
npx nx run <name>:format-check
```

## Options

<!-- option reference consistent with src/plugin.ts OxfmtPluginOptions -->

Pass via the plugin tuple in `nx.json`. Each option overrides the command string for one target:

```jsonc
{
  "plugins": [
    [
      "@nx-devkit/oxfmt",
      {
        "formatCommand": "oxfmt --write .",
        "formatCheckCommand": "oxfmt --check .",
      },
    ],
  ],
}
```

| Option               | Default           | Effect                                 |
| -------------------- | ----------------- | -------------------------------------- |
| `formatCommand`      | `oxfmt --write .` | Command for the `format` target.       |
| `formatCheckCommand` | `oxfmt --check .` | Command for the `format-check` target. |

## Config discovery

The glob mirrors oxfmt's own config search: `.oxfmtrc.json`, `.oxfmtrc.jsonc`, `oxfmt.config.ts`, and `oxfmt.config.mts`. Other extensions (`oxfmt.config.js`/`.cjs`/`.cts`) load only when passed via `oxfmt -c` — oxfmt never searches for them, so they do not trigger inference. There is no `oxfmt` key support in `package.json`.

## Skip rules

- Configs inside `node_modules` are skipped.
- Configs that escape the workspace root are skipped.
- Workspace-root configs are skipped — the plugin is for nested project roots.
- oxfmt allows only one config file per directory; if several match, the first glob hit owns the project entry.

## License

MIT
