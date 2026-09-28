# @nx-devkit/markdownlint

Standalone Nx plugin: any `.markdownlint*` config becomes a cached `lint-md` target (plus `lint-md:fix`) on the owning project. A workspace-root config lints the whole repo — Markdown linting is naturally repository-wide. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/markdownlint markdownlint-cli2
```

Depends on `@nx/devkit` `^22 || ^23`. Requires `markdownlint-cli2` `^0.20` as the lint engine.

## Register

```bash
nx add @nx-devkit/markdownlint   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/markdownlint"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 and buildCommand -->

| Trigger | Target | Command | Cacheable | Inputs |
|---|---|---|---|---|
| `.markdownlint.{json,jsonc,yaml,yml,cjs,mjs}` (rules config) | `lint-md` | `markdownlint-cli2 '**/*.md' '#**/node_modules/**' --config '<name>'` (cwd = `{projectRoot}`) | yes | `<root>/**/*.md`, config file |
| `.markdownlint-cli2.*` (cli2 options config) | `lint-md` | same, without `--config` — cli2 auto-discovers it because cwd is the config's directory | yes | same |
| either of the above | `lint-md:fix` | `markdownlint-cli2 --fix …` | no | — |

### Config types

Two file families trigger inference, and they mean different things:

- **`.markdownlint.*`** — markdownlint *rules* config (`{ "default": true, "MD013": false }`). The plugin passes it via `--config` because cli2 does not auto-discover that filename.
- **`.markdownlint-cli2.*`** — markdownlint-cli2 *runner* config (`globs`, `gitignore`, `frontMatter`, `customRules`). Never passed to `--config`; cli2 picks it up automatically.

When both live in the same directory they merge into a single target pair — the rules config goes to `--config`, the cli2 config is auto-discovered.

### Ignoring files

`node_modules` is always excluded via the built-in `#**/node_modules/**` negation glob. For `.gitignore`-driven excludes, create a `.markdownlint-cli2.jsonc`:

```jsonc
{ "gitignore": true }
```

Or add your own negation globs through the `ignoreGlobs` plugin option (see below).

## Inspect

```bash
npx nx run nx-devkit-plugins:lint-md        # or your root project name
npx nx run nx-devkit-plugins:lint-md:fix    # auto-fixable findings
```

## Skip rules

- Configs inside `node_modules` are skipped.
- Configs that escape the workspace root are skipped.
- The workspace-root config **is** a valid owner — it produces `lint-md` on the root project and lints the whole workspace.

## Options

```ts
export interface NxMarkdownlintPluginOptions {
  targetName?: string        // default 'lint-md'
  fixTargetName?: string | false  // default 'lint-md:fix'; false disables
  ignoreGlobs?: string[]     // default ['**/node_modules/**'], emitted as '#' negations
}
```

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/markdownlint",
      "options": { "ignoreGlobs": ["**/node_modules/**", ".agents/**", "docs/drafts/**"] }
    }
  ]
}
```

## License

MIT
