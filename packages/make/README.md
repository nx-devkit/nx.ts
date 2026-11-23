# @nx-devkit/make

Standalone Nx plugin: any `Makefile` becomes a set of `make:*` targets on the owning project — one `make:<goal>` per Makefile rule. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/make
```

Depends on `@nx/devkit` `^24`. Requires `make` on `PATH` (a system tool, not an npm package).

## Register

```bash
nx add @nx-devkit/make   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/make"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger    | Target        | Command                | Cacheable               |
| ---------- | ------------- | ---------------------- | ----------------------- |
| `Makefile` | `make:<rule>` | `make -C <dir> <rule>` | no (opt-in via `cache`) |

Each Makefile rule header (`name: prerequisites`) and each `.PHONY`-declared goal becomes a `make:<name>` target — one target set per directory owning a Makefile, workspace root included. Prerequisites that are themselves Makefile rules become `dependsOn` entries (`projects: "self"`), so `nx run app:make:all` runs `make:build`, `make:test`, … in order — the same graph `make` would walk.

Recipe text never lands in the inferred command — targets invoke `make`, which reads the Makefile itself.

## Skipped constructs

Goals that need the full make engine are not inferred:

- pattern rules (`%.o: %.c`) and static pattern rules (`foo.o: %.o: %.c`)
- double-colon rules (`name::`) and grouped targets (`a b &:`)
- internal helpers (`_private:`)
- GNU make special targets (`.SILENT`, `.DEFAULT_GOAL`, …)
- variable assignments (`FOO := bar` — not a rule)

`.PHONY` names without a rule still become targets — `make <name>` on a rule-less phony goal is a well-defined no-op (the `FORCE` idiom).

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/make",
      "options": {
        "targetPrefix": "make", // default — rename to e.g. "mk" for mk:* targets
        "cache": false, // default — opt in when your goals are deterministic
      },
    },
  ],
}
```

Caching is **off by default**: a Makefile gives no reliable signal for which goals produce files (`.PHONY` is advisory and frequently incomplete). When enabled, inputs are the Makefile plus the owning directory's contents, excluding `node_modules`, `.git`, `dist`, and `coverage` — declare `outputs` via `nx.json` `targetDefaults` if your goals produce files.

## Inspect

```bash
npx nx show project my-app           # see inferred targets
npx nx run my-app:make:build         # run one goal
npx nx run-many -t make:test         # across every Makefile
```
