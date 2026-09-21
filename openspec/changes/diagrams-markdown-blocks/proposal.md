# Proposal: nx-diagrams — render fenced diagram blocks inside Markdown

## Why

v1 renders standalone diagram files. In practice many diagrams live inline in docs as fenced code blocks (` ```mermaid `, ` ```plantuml `, ` ```d2 `, ` ```dot `, ` ```bpmn `, ` ```excalidraw `) — READMEs, ADRs, specs. Rendering those to images requires copying the block into a `.mmd`/`.puml` file by hand, which drifts out of sync with the prose.

## What Changes

### Trigger glob gains `**/*.md`

Markdown files join the default trigger glob. During inference the plugin reads each matched `.md` and extracts fenced code blocks whose language tag maps to a registry type:

`mermaid` → `mermaid`, `plantuml`/`puml` → `plantuml`, `d2` → `d2`, `dot`/`graphviz` → `graphviz`, `bpmn` → `bpmn`, `excalidraw` → `excalidraw`.

Non-diagram fences and diagrams-free Markdown produce no targets — zero cost beyond one file read.

### Per-block atomized targets

Each diagram block becomes its own target — same granularity as per-file v1:

| Target | Inputs | Outputs |
|---|---|---|
| `diagram-<file-slug>-<n>` | the `.md` file | `<fileName>-<n>.<format>` (1-based block ordinal among diagram fences; nominal — collision handling may append `-<type>`/`-h<hash>` suffixes) |
| `diagrams` (aggregate) | all sources incl. the `.md` | all outputs incl. block images |

The executor receives `block: <index>` (per-target) / `blocks` (aggregate) and extracts the block source itself — the plugin only declares the count/outputs contract. `block`/`blocks` indexes are **0-based** (the fence's ordinal among diagram blocks); the `<n>` in target names and output filenames is **1-based** (`index + 1`).

### Renderer resolution unchanged

Kroki POSTs the block source directly. For `commands[type]` overrides the executor writes the block to a temp file (extension derived from the type) and passes it as `{input}` — command authors keep one uniform interface.

## Out of scope

- Rewriting Markdown to inject `![](...)` references (a mutating executor is a separate design decision)
- Nested/tilde-fence exotic Markdown edge cases beyond ` ``` `/`~~~` fences
