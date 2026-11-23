# @nx-devkit/boundaries

Linter-agnostic Nx plugin: enforces module-boundary `depConstraints` between tagged projects — the `@nx/enforce-module-boundaries` idea, without requiring ESLint. Works alongside oxlint, Biome, or no linter at all.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/boundaries
```

Depends on `@nx/devkit` `^24` (installed automatically — `nx` itself comes from your workspace via devkit's peer range) and `typescript` `^5 || ^6` — the import scanner uses the TS parser's JS API (`ts.createSourceFile`), which the native `typescript@7` line does not ship.

## Register

```bash
nx add @nx-devkit/boundaries   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/boundaries",
      "options": {
        "depConstraints": [
          { "sourceTag": "type:app", "onlyDependOnLibsWithTags": ["type:feature", "type:util"] },
          { "sourceTag": "type:feature", "onlyDependOnLibsWithTags": ["type:util"] },
        ],
      },
    },
  ],
}
```

## Tag your projects

Tags live in each package's `package.json` — no `project.json` required:

```jsonc
{ "name": "@acme/web", "nx": { "tags": ["type:app"] } }
```

Nx merges `nx.*` metadata into the project whether it was inferred or declared, so `nx show project` displays the tags identically.

## What it does

- Infers a cacheable `check-boundaries` target **on every tagged project** plus a workspace-root aggregate — `nx affected -t check-boundaries` reruns only impacted checks while the root target stays the single gate.
- The executor loads the project graph, scans each tagged project's sources with the TypeScript parser (`import`, `export ... from`, `import()`, `require()` — comments and strings can't produce false positives), resolves specifiers to workspace projects (relative paths, package names, tsconfig `paths`), and evaluates `depConstraints`.
- Detects **circular dependencies** from the project graph (`dependencies` edges; implicit deps excluded) and reports them alongside edge violations.
- Violations print `file:line — source (tags) cannot depend on target (tags) via "specifier"` plus an actionable `hint:` line, and fail the target.

Semantics match the official rule: constraints apply when `sourceTag` matches the importing project's tags; the target must share a tag with `onlyDependOnLibsWithTags` and must not share a tag with `notDependOnLibsWithTags`; untagged sources are permissive; self-imports are always allowed. Tag patterns support wildcards — `*` matches any project carrying at least one tag, and partial globs like `scope:*` expand `*`; in `onlyDependOnLibsWithTags`, `*` means "the target must be tagged".

## Tag inference

Enforcement works zero-config: projects **without** `nx.tags` get tags derived from their directory layout — always `dir:<first-segment>` plus a `type:*` tag for known layouts (`apps/`/`app/` → `type:app`, `e2e/` → `type:e2e`, `libs/`/`lib/`/`packages/` → `type:lib`). Explicit `nx.tags` always win — declaring any tag disables inference for that project. Inferred tags are also written onto the project node, so `nx show project` displays them.

Tune or disable via the `inferTags` plugin option:

```jsonc
"options": {
  // false — only explicit nx.tags count (v1 behavior)
  "inferTags": false,
  // or: { "dir": false, "types": { "packages": ["type:lib"], "apps": [] } }
  //   dir — add dir:<segment> (default true)
  //   types — first-segment → tags map, merged over the defaults;
  //           an empty array removes a default mapping
}
```

## External dependencies

Bare imports that don't resolve to a workspace project are treated as external packages and checked per constraint — parity with the ESLint rule's `allowedExternalImports` / `bannedExternalImports` (both spellings accepted):

```jsonc
"depConstraints": [
  {
    "sourceTag": "type:app",
    "allowedExternalDeps": ["react", "react-*"],
    "bannedExternalDeps": ["fs-extra"]
  }
]
```

When `allowedExternalDeps` is present, unlisted packages are banned; an empty array bans all. Node builtins (`fs`, `node:path`, …) are never treated as externals.

## Run

```bash
npx nx check-boundaries        # or: npx nx run <root>:check-boundaries
npx nx run app:check-boundaries
npx nx affected -t check-boundaries
```

## Options

| Option                      | Default            | Description                                                                                                           |
| --------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `depConstraints`            | `[]`               | `[{ sourceTag, onlyDependOnLibsWithTags?, notDependOnLibsWithTags?, allowedExternalDeps?, bannedExternalDeps? }]`     |
| `targetName`                | `check-boundaries` | Inferred target name                                                                                                  |
| `inferTags`                 | `true`             | `boolean \| { dir?, types? }` — derive tags from directory layout; explicit `nx.tags` always win                      |
| `checkCircularDependencies` | `true`             | Report circular dependencies found in the project graph                                                               |
| `format`                    | `text`             | `text` \| `json` \| `mermaid` — `json` writes a machine-readable report to stdout; `mermaid` draws the violated edges |

Executor-only option (also settable via CLI, e.g. `--format=json`): `project` — restrict the check to a single project (the inferred per-project targets set it automatically).

## Non-goals (v1)

- No auto-fix (violation output carries actionable `hint:` lines instead)

## License

MIT
