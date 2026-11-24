# @nx-devkit/bazel

Standalone Nx plugin: every directory containing a `BUILD` or `BUILD.bazel` file becomes a project with `bazel:build` and — when the BUILD file declares a `*_test` rule — `bazel:test` targets. No `project.json` needed.

A narrow **bridge for mixed repos**: `nx run-many -t bazel:build` covers the Bazel side of a repo that also uses npm/Nx tooling, and `nx affected` picks up `.bzl`/`BUILD` edits through the inferred inputs. `*_test` detection is a regex scan of raw BUILD text (it can match inside comments/strings) — the plugin does not parse BUILD semantics, no `bazel query`, no per-rule targets, no dependency edges.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/bazel
```

Depends on `@nx/devkit` `^24`. Requires the `bazel` binary on `PATH` — when using Bazelisk, expose it as `bazel` (inferred targets invoke the literal `bazel` executable) — Bazel is not an npm peer dependency.

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
| `BUILD` / `BUILD.bazel`                      | `bazel:build` | `bazel build //<pkg>:all` | no        |
| same, when the file has a `*_test(...)` rule | `bazel:test`  | `bazel test //<pkg>:all`  | no        |

- `//<pkg>` is the Bazel package path relative to the nearest ancestor holding `WORKSPACE`, `WORKSPACE.bazel`, or `MODULE.bazel` (the Nx workspace root when none exists). Commands run with `cwd` = the project root — Bazel itself walks up to its workspace root.
- Projects are named `bazel:<relpath>` — except the workspace root's BUILD file, which is named just `bazel` (no colon). A dir that also has a `package.json` keeps that package's `name` instead.
- Inputs: `{projectRoot}/**` minus `bazel-*` output symlinks, plus the BUILD file(s) and ancestor workspace markers.
- `cache: false` — Bazel owns `bazel-*` outputs (symlinks into output_user_root) that Nx cannot capture or restore, so a cache hit would skip the build while leaving no output tree. Bazel's own cache still dedupes the real work.

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
