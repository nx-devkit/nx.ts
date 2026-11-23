# @nx-devkit/ci-lint

Zero-config Nx plugin: `.github/workflows/*.{yml,yaml}` files infer a cached
`lint-ci` target on the root project — GitHub Actions workflow linting with
[actionlint](https://github.com/rhysd/actionlint) and security auditing with
[zizmor](https://github.com/zizmorcore/zizmor), no `project.json` required.

## Install

```bash
bunx nx g @nx-devkit/ci-lint:init
# or register manually in nx.json:
#   { "plugins": ["@nx-devkit/ci-lint"] }
```

Then run:

```bash
nx lint-ci
```

## Tools are optional peers

The generated command probes each tool with `command -v` before running it:

- **actionlint** — install via npm (`bun add -d actionlint`), brew, or go.
  An optional `peerDependencies` entry declares it; the init generator adds
  it to `devDependencies`.
- **zizmor** — not on npm; install via `pipx install zizmor`,
  `cargo install zizmor`, or `brew install zizmor`.

A missing tool prints `ci-lint: <tool> not found on PATH — skipping` and the
target still succeeds; an installed tool's real findings fail the target.

## Options

| Option           | Type                     | Default   | Description                                        |
| ---------------- | ------------------------ | --------- | -------------------------------------------------- |
| `targetName`     | `string`                 | `lint-ci` | Name of the inferred target.                       |
| `actionlint`     | `boolean`                | `true`    | Run actionlint when installed.                     |
| `zizmor`         | `boolean`                | `true`    | Run zizmor when installed.                         |
| `actionlintArgs` | `string`                 | `""`      | Extra args appended to actionlint.                 |
| `zizmorArgs`     | `string`                 | `""`      | Extra args appended to zizmor (before the inputs). |
| `zizmorFormat`   | `plain \| json \| sarif` | `plain`   | `zizmor --format` value.                           |
| `zizmorOutput`   | `string`                 | —         | Redirect zizmor output to this file.               |

### SARIF for GitHub code scanning

```jsonc
{
  "plugin": "@nx-devkit/ci-lint",
  "options": { "zizmorFormat": "sarif", "zizmorOutput": "zizmor.sarif" },
}
```

Then upload `zizmor.sarif` with `github/codeql-action/upload-sarif`.

## How it works

The plugin watches `.github/workflows/*.{yml,yaml}` — workflow files are
inherently repo-wide, so the target lands on the root project (`.`). The
target is `cache: true` with inputs covering the workflow glob plus
`.github/actionlint.{yml,yaml}` and `zizmor.{yml,yaml}` configs, so any edit
busts the cache.
