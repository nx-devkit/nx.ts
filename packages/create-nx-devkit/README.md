# @nx-devkit/create

`npm create @nx-devkit` — land in a working zero-config Nx monorepo in one command.

Thin launcher: it detects your package manager (bun / npm / pnpm / yarn), installs
`nx` + `@nx-devkit/typescript` in the target directory, and delegates all scaffolding
to the `monorepo` generator at `@nx-devkit/typescript:monorepo`. The preset infers
`typecheck`, `test`, `lint`, `format`, and `build` targets from config files —
no `project.json` required.

## Usage

New workspace (creates `./my-workspace`):

```bash
npm create @nx-devkit my-workspace
```

Scaffold into the current directory (into-existing-repo mode):

```bash
npm create @nx-devkit .
```

Works with every PM:

```bash
npm create @nx-devkit my-workspace
bunx --bun @nx-devkit/create my-workspace
pnpm create @nx-devkit my-workspace
yarn create @nx-devkit my-workspace
```

## Options

Flags mirror the `monorepo` generator options:

```text
Usage: npm create @nx-devkit [name|.] [options]

  name                  First package name — creates ./<name> (npm package name)
  .                     Scaffold into the current directory

Options:
  --dir <path>          Target directory explicitly
  --pm <pm>             Package manager: bun | npm | pnpm | yarn (default: detected)
  --package-dir <dir>   packages | apps | libs (default: packages)
  --native-test         Native Node test runner instead of vitest
  --no-test             Skip vitest
  --no-lint             Skip oxlint
  --no-format           Skip biome
  --no-build            Skip tsdown
  --no-install          Skip dependency install
  -h, --help            Show this help
```

The package manager is auto-detected from `npm_config_user_agent` (the PM that
launched `npm create`/`bunx`/`pnpm create`/`yarn create`), falling back to
lockfiles in the target directory, then `npm`. `--pm` overrides detection.

## Result

```text
my-workspace/
├── nx.json                # registers @nx-devkit/typescript — that's it
├── package.json
├── tsconfig.base.json
└── packages/<name>/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts   # → test, test:watch, test:coverage
    ├── .oxlintrc.json     # → lint
    ├── biome.json         # → format, format-check
    ├── tsdown.config.ts   # → build, build:watch
    └── src/index.ts       # → typecheck via tsconfig.json
```

After scaffolding, `cd my-workspace && nx run-many -t typecheck,test,lint,build`
passes with no manual config.
