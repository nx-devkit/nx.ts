# @nx-devkit/openspec

Standalone Nx plugin: any `openspec/config.yaml` becomes a cached `spec-validate` target, plus one `spec-validate:<change-id>` target per active change. Spec validation becomes an Nx target with per-change caching — no `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/openspec @fission-ai/openspec
```

Depends on `@nx/devkit` `^22 || ^23`. Requires `@fission-ai/openspec` `^1` as the spec engine.

## Register

```bash
nx add @nx-devkit/openspec   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/openspec"] }
```

## What it infers

| Trigger | Target | Command | Cacheable | Inputs |
|---|---|---|---|---|
| `openspec/config.yaml` | `spec-validate` | `openspec validate --all --strict` (cwd = `{projectRoot}`) | yes | `<root>/openspec/**` |
| `openspec/changes/<id>/proposal.md` (each dir) | `spec-validate:<id>` | `openspec validate '<id>' --strict` | yes | `<root>/openspec/changes/<id>/**` |

Per-change targets mean editing `changes/alpha/` re-validates only `alpha` — the aggregate `spec-validate` still exists for full sweeps (`nx run-many -t spec-validate` covers both).

## Inspect

```bash
npx nx show projects
npx nx run <name>:spec-validate
npx nx run <name>:spec-validate:my-change
```

## Skip rules

- Configs inside `node_modules` are skipped.
- Configs that escape the workspace root are skipped.
- `openspec/changes/archive/` and change dirs without `proposal.md` produce no per-change targets.
- The workspace-root `openspec/` is a valid owner — repo-wide spec validation is the primary use.

## Options

```ts
export interface NxOpenSpecPluginOptions {
  targetName?: string   // default 'spec-validate' (per-change: '<targetName>:<id>')
  perChange?: boolean   // default true
  strict?: boolean      // default true — appends --strict
}
```

## License

MIT
