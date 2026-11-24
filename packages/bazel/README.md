# @nx-devkit/bazel

Standalone Nx plugin: every directory containing a `BUILD` or `BUILD.bazel` file becomes a project with `bazel:build` and — when the BUILD file declares a `*_test` rule — `bazel:test` targets. No `project.json` needed.

A narrow **bridge for mixed repos**: `nx run-many -t bazel:build` covers the Bazel side of a repo that also uses npm/Nx tooling, and `nx affected` picks up `.bzl`/`BUILD` edits through the inferred inputs. It does not parse BUILD semantics — no `bazel query`, no per-rule targets, no dependency edges.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/bazel
```

Depends on `@nx/devkit` `^24`. Requires the `bazel` binary (or bazelisk) on `PATH` — Bazel is not an npm peer dependency.

## Register

```bash
nx add @nx-devkit/bazel   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/bazel"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                                      | Target        | Command                   | Cacheable |
| -------------------------------------------- | ------------- | ------------------------- | --------- |
| `BUILD` / `BUILD.bazel`                      | `bazel:build` | `bazel build //<pkg>:all` | yes       |
| same, when the file has a `*_test(...)` rule | `bazel:test`  | `bazel test //<pkg>:all`  | yes       |

- `//<pkg>` is the Bazel package path relative to the nearest ancestor holding `WORKSPACE`, `WORKSPACE.bazel`, or `MODULE.bazel` (the Nx workspace root when none exists). Commands run with `cwd` = the project root — Bazel itself walks up to its workspace root.
- Projects are named `bazel:<relpath>`; a dir that also has a `package.json` keeps that package's `name` instead.
- Inputs: `{projectRoot}/**` minus `bazel-*` output symlinks, plus the BUILD file(s) and ancestor workspace markers.
- `cache: true` — Bazel is already hermetic; the Nx cache is a bonus. Outputs are intentionally empty (Bazel owns `bazel-*`).

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/bazel",
      "options": { "targetPrefix": "bazel" }, // → <prefix>:build, <prefix>:test
    },
  ],
}
```

## Inspect

```bash
npx nx show projects                    # see inferred bazel:* projects
npx nx run bazel:services/api:bazel:build
npx nx run-many -t bazel:build          # every Bazel package in the repo
npx nx affected -t bazel:build bazel:test
```
