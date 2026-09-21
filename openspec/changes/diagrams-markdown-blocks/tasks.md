# Tasks

- [x] `src/blocks.ts`: `extractDiagramBlocks(md)` — ` ``` `/`~~~` fences (up to 3 leading spaces, closing fence same marker ≥ opening length), lang → type map, non-diagram fences suppress nested diagram fences, skip non-diagram fences
- [x] plugin.ts: add `.md` (case-insensitive) to DEFAULT_GLOB; read md at inference; per-block entries `diagram-<slug>-<n>` → `<fileName>-<n>.<format>`; aggregate passes `blocks` aligned to `files`
- [x] render executor: `block`/`blocks` options — extract block source, block type drives renderer; `mkdtempSync` temp input named `{fileName}<ext>` for command mode; out-of-range error; dryRun logs block info; fallback outputs carry the block suffix
- [x] schema.json + schema.d.ts: `block?: integer ≥ 0`, `blocks?: (integer | null)[]`
- [x] Tests: blocks.spec (extractor incl. adversarial + proto-pollution + nesting), plugin.spec (md inference, no-block md, mixed types, collisions), render.spec (block via kroki, command temp file, out-of-range)
- [x] Verify: `bunx vitest run` (76/76), `bun run build`, `bun run lint`, `bun run format:check`, `bun run check:spec`, `openspec validate diagrams-markdown-blocks --strict`
- [x] README: document Markdown block support (dogfooded — README's own mermaid fence renders to README-1.svg)
