# nx-diagrams Specification — Markdown fenced blocks delta

## ADDED Requirements

### Requirement: Markdown files trigger per-block target inference
The default trigger glob MUST additionally cover `**/*.md` (case-insensitive). For each matched Markdown file the plugin MUST extract fenced code blocks (``` ``` ``` or `~~~` fences) whose language tag maps to a registry type — `mermaid`, `plantuml`/`puml`, `d2`, `dot`/`graphviz`, `bpmn`, `excalidraw` — and MUST infer one `diagram-<file-slug>-<n>` target per block, where `<n>` is the 1-based ordinal among diagram fences in that file. Fences with unmapped or missing language tags MUST be ignored. A Markdown file with zero diagram blocks MUST produce no targets.

#### Scenario: Markdown with mermaid block
- **WHEN** `docs/guide.md` contains one ` ```mermaid ` block
- **THEN** the owning project gets a `diagram-docs-guide-1` target with `inputs` containing `docs/guide.md` and `outputs` containing `docs/guide-1.svg`

#### Scenario: Markdown without diagram fences
- **WHEN** `README.md` contains only prose and ` ```ts ` blocks
- **THEN** no targets are inferred for it

#### Scenario: Multiple block types in one file
- **WHEN** `arch.md` contains a ` ```mermaid ` block followed by a ` ```d2 ` block
- **THEN** targets `diagram-arch-1` and `diagram-arch-2` are inferred; each renders with its own fence's type

#### Scenario: Aggregate aligns repeated file entries with block indexes
- **WHEN** `arch.md` contains two diagram blocks
- **THEN** the aggregate target's `files` option lists `arch.md` twice, `blocks` is `[0, 1]`, and `outputs` lists `arch-1.svg` and `arch-2.svg` at the matching positions — `files[i]`/`blocks[i]`/`outputs[i]` describe one render unit

### Requirement: Block rendering in the render executor
When a target carries a `block` index (single mode) or a `blocks` array aligned to `files` (aggregate mode, `null` for whole-file entries), the executor MUST extract that block's source and render it with the block's fence-mapped type — via `commands[type]` or Kroki — instead of reading the file as diagram source. A `block` index outside the file's diagram blocks MUST fail with an actionable error. For command overrides the executor MUST write the block source to a temp file whose extension matches the type's canonical extension and pass it as `{input}`.

#### Scenario: Block rendered via Kroki
- **WHEN** a target has `file: "guide.md"`, `block: 0`, and the fence language is `mermaid`
- **THEN** the executor POSTs the block body (not the full Markdown) to `{krokiUrl}/mermaid/{format}`

#### Scenario: Stale block index
- **WHEN** a target requests `block: 2` but the file now has one diagram block
- **THEN** the executor fails naming the file and the out-of-range index

#### Scenario: Command override for a block
- **WHEN** `commands.mermaid` is configured and a mermaid block renders
- **THEN** the block body is written to a temp `.mmd` file passed as `{input}` and no HTTP request is made
