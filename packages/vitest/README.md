# @nx-devkit/vitest

Standalone Nx plugin: any `vitest.config.*` becomes a project with cached `test`, `test:watch`, and `test:coverage` targets. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts). If you want the full TypeScript toolchain (typecheck, test, lint, format, build), use the [`@nx-devkit/typescript`](../typescript-preset/README.md) preset instead — it includes everything this plugin does, plus a `node --test` fallback for projects without a vitest config.

## Install

```bash
bun add -D @nx-devkit/vitest vitest
```

Depends on `@nx/devkit` `^22 || ^23` (installed automatically). Requires the `vitest` `^4` peer — the targets shell out to it via `nx:run-commands`.

## Register

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/vitest"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger | Target | Command | Cacheable | Outputs |
|---|---|---|---|---|
| `vitest.config.{ts,js,mts,mjs,cts,cjs}` | `test` | `vitest run` | yes | `{projectRoot}/coverage` |
| same | `test:watch` | `vitest` | no | — |
| same | `test:coverage` | `vitest run --coverage` | yes | `{projectRoot}/coverage` |

All targets declare `dependsOn: ["^build"]`, so upstream dependencies build first.

## Inspect

```bash
npx nx show projects
npx nx show project <name>
npx nx run <name>:test
```

## Skip rules

- Configs inside `node_modules` are skipped.
- Configs that escape the workspace root are skipped.
- The workspace-root `vitest.config.*` is skipped — the plugin is for nested project roots. Use the preset (`@nx-devkit/typescript`) if you want the root to become a project.

## Options

None. Behavior is entirely file-driven.

## License

MIT
