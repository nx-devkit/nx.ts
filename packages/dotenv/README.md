# @nx-devkit/dotenv

Standalone Nx plugin: a `.env.example` or `.env.sample` file becomes a cacheable `env:check` target on the owning project — it fails loud, listing every required var that is missing from `process.env` or the sibling `.env` file. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/dotenv
```

Depends on `@nx/devkit` `^24`. No other peer dependency — the checker is a bundled executor.

## Register

```bash
nx add @nx-devkit/dotenv   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/dotenv"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                        | Target      | Executor                  | Cacheable |
| ------------------------------ | ----------- | ------------------------- | --------- |
| `.env.example` / `.env.sample` | `env:check` | `@nx-devkit/dotenv:check` | yes       |

One `env:check` per directory that owns an example file — a project with both `.env.example` and `.env.sample` gets a single target that verifies both.

`env:check` parses the declared keys out of each example file and fails when any of them is unset — neither in `process.env` nor in the resolved `.env` file (the `.env` sibling of the example, or the executor's `envFile` option). Missing names are listed; **values are never printed**.

### Cache semantics

The target's inputs are the example files themselves, the sibling `.env`, and one `{ env: KEY }` runtime input per declared var — so adding a required var to the template, filling it into `.env`, or (un)setting it in the environment all bust the cache. Nx hashes env inputs; values never appear in argv or in the target definition.

## Gate other targets on the check

A plugin cannot edit `targetDefaults`, so wire the check into the targets that need env — per target in `nx.json` or a `project.json`:

```jsonc
// nx.json
{
  "targetDefaults": {
    "dev": { "dependsOn": ["env:check"] },
    "db:migrate": { "dependsOn": ["env:check"] },
  },
}
```

Or point a script at it: `"precheck": "nx run-many -t env:check"`.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/dotenv",
      "options": { "targetName": "env:check" },
    },
  ],
}
```

| Option       | Default     | Description                       |
| ------------ | ----------- | --------------------------------- |
| `targetName` | `env:check` | Name of the inferred check target |

## Secrets stay out of argv and logs

The checker reads files and `process.env` — never command-line flags. Failure output lists missing var **names** only, so a leaked log line cannot leak a leaked secret.

## Inspect

```bash
npx nx show project my-app        # see inferred targets
npx nx env:check my-app           # verify required vars (cached)
npx nx run-many -t env:check      # across every package with an example file
```
