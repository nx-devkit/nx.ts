# @nx-devkit/diagrams

Agent guide for working in `packages/diagrams/`. Touch ONLY this directory unless the bead body says otherwise.

## What it does

Infers cached, atomized render targets for text-diagram files (`*.puml`, `*.mmd`, `*.dot`, `*.d2`, `*.bpmn`, `*.excalidraw`, …) — one `diagram-<relpath-slug>` target per file plus an aggregate `diagrams` target per project. Rendering goes through Kroki by default or through per-type `commands` overrides.

## File layout

```
packages/diagrams/
├── package.json            # executors/generators fields → manifests below
├── executors.json          # render executor manifest
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: index, plugin, executors/render/executor, generators/init/generator
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts            # public surface
│   ├── plugin.ts           # createNodesV2 + DIAGRAM_TYPES registry + slug/output helpers
│   ├── plugin.spec.ts
│   ├── jsonc.ts            # shared JSONC helpers (parse, detectIndent)
│   ├── executors/render/   # executor.ts + schema.json + schema.d.ts + render.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
└── README.md
```

## Plugin options interface

```ts
export interface NxDiagramsPluginOptions {
  targetName?: string                 // aggregate target, default 'diagrams'
  format?: 'svg' | 'png' | 'jpeg'     // default 'svg'
  krokiUrl?: string                   // default 'https://kroki.io'; '' disables
  outputDir?: string                  // tokens {fileDir} {fileName} {projectRoot}, default '{fileDir}'
  commands?: Record<string, string>   // per-type local renderer overrides
  include?: string[]                  // extra glob filters (workspace-relative paths)
  exclude?: string[]
}
```

## Invariants

- Per-file targets are `cache: true` with single-file `inputs` and the rendered image in `outputs`.
- `commands[type]` wins over Kroki. All placeholders are workspace-relative and expand shell-quoted; commands run with `cwd` = workspace root.
- `krokiUrl` must be absolute http(s) or empty. Empty + no command for the type → actionable error.
- `timeout` must be positive; `outputDir` must resolve inside the workspace.
- Colliding slugs/outputs get deterministic `-<type>` then `-h<hash>` suffixes; the resolved paths travel to the executor via `options.output`/`options.outputs` — never recompute them there.
- `dryRun` never writes files, never calls renderers.
- The init generator edits `nx.json` via `jsonc-parser` (comments/formatting preserved) — never `JSON.stringify` an existing file.

## TDD workflow

1. Write failing `*.spec.ts` (vitest). Mock `node:child_process` `spawnSync` and `globalThis.fetch` via the `state` object pattern (see `render.spec.ts`) — `vi.mocked` is unavailable under `bun test`.
2. `bun test packages/diagrams` → RED → implement → GREEN.
3. `bun run build`, `bun run lint`, `bun run format:check`, `bun run check:spec`, `bunx openspec validate`.

## Gotchas

- `createNodesV2` glob is static — new extensions require editing `DIAGRAM_TYPES` in `plugin.ts`.
- `globToRegExp` placeholder order matters: `?` must be converted before regex syntax is injected.
- `outputPathFor` tokens and the returned path are all workspace-relative — `{projectRoot}` expands to the project root (no second prepend).
