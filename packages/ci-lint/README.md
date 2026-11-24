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

The generated command probes each tool on PATH (`command -v` / `where`)
before running it:

- **actionlint** — install the CLI via `brew install actionlint`,
  `go install github.com/rhysd/actionlint/cmd/actionlint@latest`, scoop, or
  the [download script](https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash).
  npm's `actionlint` package is a WASM API — it does not put the CLI on PATH,
  so the init generator does not install it.
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

Then upload `zizmor.sarif` with `github/codeql-action/upload-sarif`. Add
`if: always()` to that step: `nx lint-ci` fails when zizmor reports findings,
and GitHub otherwise skips the upload.

## How it works

The plugin watches `.github/workflows/*.{yml,yaml}` — workflow files are
inherently repo-wide, so the target lands on the root project (`.`). The
target is `cache: true` with inputs covering the workflow glob plus
`.github/actionlint.{yml,yaml}`, `.github/zizmor.{yml,yaml}`, and
`zizmor.{yml,yaml}` configs, plus a runtime hash of each enabled tool's
`--version` — so config edits or installing/upgrading a linter bust the
cache. Every installed tool runs even when another reports violations; the
target fails if any leg fails.
