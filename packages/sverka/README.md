# @nx-devkit/sverka

Zero-config Nx plugin for [sverka](https://sverka.dev): a sverka config
automatically produces **one Nx target per reachable sverka step** — no
`project.json` needed, and no "run the whole workflow" mega-target.

Each step keeps its own inputs, outputs and cache entry, so Nx can run the
steps in parallel, cache them individually and restore a single step from the
cache without re-running the ones before it.

---

## Contents

- [Install](#install)
- [Usage](#usage)
- [What the plugin infers](#what-the-plugin-infers)
- [How the artifact bridge works](#how-the-artifact-bridge-works)
- [The caching model](#the-caching-model)
- [Generate a config](#generate-a-config)
- [Options](#options)
- [Troubleshooting](#troubleshooting)
- [Design notes](#design-notes)

---

## Install

```bash
nx add @nx-devkit/sverka
```

The init generator registers the plugin in `nx.json` and installs
`@sverka/workflow` (the package the sverka config imports).

## Usage

Drop a `sverka.config.ts` next to your project and the owning project gains
one target per step:

```ts
// packages/app/sverka.config.ts
import { Project, Pipeline, ShellStep, Entry, push } from '@sverka/workflow'

const proj = new Project('app')
const ci = new Pipeline(proj, 'ci')

const lint = new ShellStep(ci, 'lint', { command: 'bun run lint' })
const test = new ShellStep(ci, 'test', {
  command: 'bun run test',
  dependsOn: [lint.node.id],
})

export const onPush = new Entry(ci, 'on-push', {
  trigger: push(),
  roots: [test.node.id],
})

export default proj
```

```bash
nx run app:ci:lint          # one step
nx run app:ci:test          # runs ci:lint first (dependsOn)
nx run-many -t ci:lint      # every project with a sverka config
nx affected -t ci:lint      # only the projects whose files changed
```

A target name contains a colon, so `nx run app:ci:lint` is ambiguous to
read — the explicit form always works:

```bash
nx run --project=app --target=ci:lint
```

The target name is `<pipeline>:<step>` — the sverka step `ci/lint` becomes
the Nx target `ci:lint`. The config's directory is the project root, so a
config in `packages/app` gives the targets to that project (the project
*name* comes from its `package.json` — `app` in the example below; without
a `package.json` the project is named after its path, `packages/app`).

A step is inferred when an entry can reach it — a step that no entry
references gets no target.

The plugin watches `sverka.config.ts`, `sverka.config.mts`,
`sverka.config.js` and `sverka.config.mjs`.

## What the plugin infers

| Nx target field | sverka source |
|---|---|
| target name | `<pipeline>:<step>` (configurable) |
| `executor` | `@nx-devkit/sverka:step` — runs exactly one step |
| `options.step` | the sverka step id (`ci/lint`) |
| `options.entry` | the sverka entry that reaches the step (`ci/on-push`) |
| `dependsOn` | the step's sverka dependencies (`control`, `value`, `artifact`) |
| `inputs` | the project files, the sverka config, the consumed artifacts |
| `outputs` | the files the step declares as outputs |
| `cache` | `true` — every step is cached on its own |

Concretely, for the config above:

```jsonc
"ci:test": {
  "executor": "@nx-devkit/sverka:step",
  "options": { "step": "ci/test", "entry": "ci/on-push" },
  "dependsOn": ["ci:lint"],
  "inputs": [
    "{projectRoot}/**/*",
    "!{projectRoot}/.sverka/workspace/**",
    "!{projectRoot}/.sverka/artifacts/ci/test/**",
    "{projectRoot}/sverka.config.ts",
  ],
  "outputs": [],
  "cache": true,
}
```

## How the artifact bridge works

Sverka steps hand artifacts to each other through an artifact store that
lives **inside a single run** — the engine writes them to
`<artifactDir>/<runId>/<stepId>/<output>`, where the run id is a fresh UUID
per run. Nx runs each step as its own task (possibly in another process) and
caches the results in between, so that store is useless to Nx: the path
changes on every run and no two tasks share it.

The plugin bridges the two worlds with stable paths inside the project:

```text
<projectRoot>/.sverka/artifacts/<stepId>/<output>      # artifact outputs
<projectRoot>/.sverka/artifacts/<stepId>/values/<name> # value outputs
```

- **Before the step runs**, the executor copies every artifact the step
  imports from the producer's stable path into the project directory (where
  the sverka engine expects it) and reads the producer's values back so
  `${producer.value}` still interpolates.
- **After the step runs**, the executor copies the step's own artifacts and
  values to their stable paths.

Those paths are the target's `outputs`, and the consuming step declares them
as its `inputs` — Nx caches and restores them between the two tasks. A step
that produces a SARIF report and a step that gates on it are two tasks with
two cache entries, connected by one artifact.

Value outputs (strings, numbers, booleans) travel the same way: the
producer publishes them under `…/values/<name>`, the consumer reads them
back and passes them into the engine, where the command interpolation
resolves them.

## The caching model

Every step is cached on its own. Three rules keep the cache honest:

1. **A step's own outputs are never its inputs.** The declared outputs, the
   imported artifacts and the files a shell step redirects into (`> file`)
   are excluded from the inputs of *every* step of the config — otherwise a
   step would invalidate itself (and its neighbours) on every run.
2. **A consumer depends on its producer.** The consumed artifact is both an
   input of the consumer (its content decides the cache key) and a
   `dependentTasksOutputFiles` input (Nx folds the producer's hash into the
   consumer's, so a changed producer invalidates the consumer).
3. **The sverka config is an input.** Editing the config changes the hash of
   every step it defines.

Verified behaviour:

| Situation | Result |
|---|---|
| run the same step twice | second run is a cache hit |
| edit a source file of the project | the step re-runs |
| change the artifact a producer emits | the consumer re-runs |
| edit the sverka config | every step of the config re-runs |

The very first run of a *consumer* misses once — Nx computes the consumer's
hash before the producer's output exists. This is stock Nx behaviour for
every `build → test` chain (reproduced with a plain `nx:run-commands`
pair), not something the plugin adds; it converges on the next run.

### Declare your outputs

A step that writes a file into the project invalidates its own cache: the
file is part of the project files the target hashes, and an output at the
same time. Declare the file in the sverka config — the plugin then excludes
it from the inputs and Nx restores it from the cache:

```ts
new ShellStep(ci, 'lint', {
  command: 'eslint . --format json --output-file report.json',
  outputs: { 'report.json': { type: 'artifact', path: 'report.json' } },
})
```

Steps that redirect (`tool > report.txt`) are detected automatically. The
detection is conservative on purpose: only stdout redirections of a command
without quotes count, so a `>` inside a string and a stderr redirection
(`2> errors.txt`) never hide a file from the cache.

## Generate a config

```bash
nx g @nx-devkit/sverka:config --project=app
```

The generator reads what the project already has — its `package.json`
scripts and its Nx targets — and writes a `sverka.config.ts` with one step
per check:

```ts
new ShellStep(ci, "lint", { command: "bun run lint" })
new ShellStep(ci, "test", { command: "bun run test" })
new ShellStep(ci, "build", { command: "bun run build" })
```

GitHub-side checks (they verify the state of the repository, not the code)
are opt-in:

```bash
nx g @nx-devkit/sverka:config --project=app \
  --githubChecks=main-green,review-debt,dependabot-alerts,code-scanning,secret-scanning
```

| Check | What it verifies |
|---|---|
| `main-green` | every GitHub Actions check-run on `main` is green |
| `review-debt` | no unresolved review threads in the last 20 merged PRs (GraphQL) |
| `dependabot-alerts` | no open Dependabot alerts (advanced security) |
| `code-scanning` | no open code-scanning alerts (advanced security) |
| `secret-scanning` | no open secret-scanning alerts (advanced security) |
| `stale-branches` | no remote branch left behind by a merged PR |
| `open-prs` | lists the open PRs (informational) |

They land in a second pipeline (`repo-health`) with read-scoped permissions
and the `GITHUB_TOKEN` secret, and are driven by the `gh` CLI — so they work
locally (`gh auth login`) and in CI.

`dependabot-alerts` needs the `vulnerability-alerts` permission, which the
workflow `GITHUB_TOKEN` does not carry. The generated pipeline declares an
optional `REPO_HEALTH_TOKEN` secret for it: without that token the check
prints a warning and skips instead of failing.

## Options

Register with options in `nx.json`:

```jsonc
{
  "plugins": [
    {
      "plugin": "@nx-devkit/sverka",
      "options": {
        "entry": "ci/on-push",             // default: every entry
        "targetName": "{pipeline}:{step}", // default
        "cache": true,                    // default
        "inputs": ["{workspaceRoot}/bun.lock"]
      }
    }
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `entry` | every entry | Restrict the inference to one sverka entry. |
| `targetName` | `{pipeline}:{step}` | Target name template (`{pipeline}`, `{step}`, `{id}`). |
| `inputs` | `[]` | Extra input globs for every inferred target. |
| `cache` | `true` | Cache the inferred targets. |

## Troubleshooting

**`could not load sverka.config.ts: …`** — the config could not be
evaluated. The plugin warns and skips it instead of breaking the project
graph. The usual cause is a missing `@sverka/workflow` in the project — run
`nx add @nx-devkit/sverka`, or install it directly.

**`Module type of file://…/sverka.config.ts is not specified`** — Node
warns because the config is TypeScript in a package without
`"type": "module"`. Add `"type": "module"` to the project's `package.json`
(or rename the config to `sverka.config.mts`).

**`imports "eslint.sarif" from "ci/lint-sarif", but … does not exist`** —
the producing task did not run. The artifact is restored by the producer's
cache entry, so run the dependency (`nx run app:ci:policy` runs
`ci:lint-sarif` first) or run the producer explicitly.

**The step re-runs every time** — the step writes a file into the project
without declaring it (see [Declare your outputs](#declare-your-outputs)).

## Design notes

- **The step runs on the sverka engine.** The executor builds a run plan
  with a single step and hands it to `@sverka/runtime`, so agent steps,
  secrets, runtime modes, reports and retries keep their sverka semantics.
  The step's dependency edges are dropped — Nx already ran the producers.
- **The config is loaded in-process.** The plugin imports the config with a
  dynamic `import()` (Node strips the types, >= 22.18). The URL carries the
  config's mtime, so the Nx daemon re-evaluates it after an edit instead of
  serving a stale module instance.
- **`@sverka/*` resolves with a fallback.** The config's own imports are
  resolved from the project; when the project has no `@sverka/*` packages, a
  resolve hook falls back to the copies bundled with this plugin. The
  construct markers are `Symbol.for`-based, so the two copies interoperate.
- **The plugin never breaks the graph.** A config that fails to load is
  reported and skipped.

## License

MIT
