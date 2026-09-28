# @nx-devkit/boundaries

Linter-agnostic Nx plugin: enforces module-boundary `depConstraints` between tagged projects — the `@nx/enforce-module-boundaries` idea, without requiring ESLint. Works alongside oxlint, Biome, or no linter at all.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/boundaries
```

Depends on `@nx/devkit` `^22 || ^23` (installed automatically — `nx` itself comes from your workspace via devkit's peer range) and `typescript` `>=5` (the import scanner uses the TS parser).

## Register

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/boundaries",
      "options": {
        "depConstraints": [
          { "sourceTag": "type:app", "onlyDependOnLibsWithTags": ["type:feature", "type:util"] },
          { "sourceTag": "type:feature", "onlyDependOnLibsWithTags": ["type:util"] }
        ]
      }
    }
  ]
}
```

## Tag your projects

Tags live in each package's `package.json` — no `project.json` required:

```jsonc
{ "name": "@acme/web", "nx": { "tags": ["type:app"] } }
```

Nx merges `nx.*` metadata into the project whether it was inferred or declared, so `nx show project` displays the tags identically.

## What it does

- Infers one `check-boundaries` target on the workspace root — **only when at least one project declares `nx.tags`** (a tagless workspace would be a false green).
- The executor loads the project graph, scans each tagged project's sources with the TypeScript parser (`import`, `export ... from`, `import()`, `require()` — comments and strings can't produce false positives), resolves specifiers to workspace projects (relative paths, package names, tsconfig `paths`), and evaluates `depConstraints`.
- Violations print `file:line — source (tags) cannot depend on target (tags) via "specifier"` and fail the target.

Semantics match the official rule: constraints apply when `sourceTag` is in the importing project's tags; the target must share a tag with `onlyDependOnLibsWithTags`; untagged sources are permissive; self-imports are always allowed.

## Run

```bash
npx nx check-boundaries        # or: npx nx run <root>:check-boundaries
npx nx affected -t check-boundaries
```

## Options

| Option | Default | Description |
|---|---|---|
| `depConstraints` | `[]` | `[{ sourceTag, onlyDependOnLibsWithTags }]` — same shape as the official rule |
| `targetName` | `check-boundaries` | Inferred target name on the root project |

## Non-goals (v1)

- No circular-dependency detection
- No npm/external-package constraints (`bannedExternalImports`)
- No auto-fix

## License

MIT
