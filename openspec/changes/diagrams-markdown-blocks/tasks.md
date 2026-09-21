# Tasks

- [ ] `src/blocks.ts`: `extractDiagramBlocks(md)` — ` ``` `/`~~~` fences, lang → type map, skip non-diagram fences
- [ ] plugin.ts: add `.md` (case-insensitive) to DEFAULT_GLOB; read md at inference; per-block entries `diagram-<slug>-<n>` → `<fileName>-<n>.<format>`; aggregate passes `blocks` aligned to `files`
- [ ] render executor: `block`/`blocks` options — extract block source, block type drives renderer; temp input file for command mode; out-of-range error; dryRun logs block info
- [ ] schema.json + schema.d.ts: `block?: number`, `blocks?: (number | null)[]`
- [ ] Tests: blocks.spec (extractor), plugin.spec (md inference, no-block md, mixed types, collisions), render.spec (block via kroki, command temp file, out-of-range)
- [ ] Verify: `bun test`, `bun run build`, `bun run lint`, `bun run format:check`, `bun run check:spec`, `openspec validate diagrams-markdown-blocks --strict`
- [ ] README: document Markdown block support
