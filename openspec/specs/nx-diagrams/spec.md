# nx-diagrams Specification

## Purpose
Renders text-diagram source files (PlantUML, Mermaid, Graphviz, D2, BPMN, Excalidraw, …) — standalone files and fenced blocks inside Markdown — to images as cached, atomized Nx targets. Kroki is the default rendering backend; per-type shell commands override it for offline or private rendering.
## Requirements
### Requirement: Diagram files trigger per-file target inference
The plugin MUST use `createNodesV2` with a default trigger glob covering `**/*.{puml,plantuml,mmd,mermaid,dot,gv,d2,bpmn,excalidraw}` — extension matching is case-insensitive (`.PUML`, `.ExCaLiDrAw` match on case-sensitive filesystems) — and MUST infer one `diagram-<relpath-slug>` target per matched file on the owning project, plus a `diagrams` aggregate target on projects containing at least one match. `createNodesV2` MUST return exactly one project configuration per owning project root, regardless of how many files match under it.

#### Scenario: Single diagram file
- **WHEN** `packages/docs/diagrams/auth.puml` exists in project `packages/docs`
- **THEN** the owning project gets a `diagram-diagrams-auth` target (slug from the project-relative path) with `cache: true`, `inputs` containing the source file, `outputs` containing the rendered image path, and executor `@nx-devkit/diagrams:render`

#### Scenario: Aggregate target
- **WHEN** a project contains at least one diagram file
- **THEN** it also gets a `diagrams` target running the render executor over all of the project's diagram files

#### Scenario: No diagrams
- **WHEN** a project contains no matched files
- **THEN** no diagram targets are inferred for it

#### Scenario: One configuration per project root
- **WHEN** `a.puml` and `b.mmd` live under project root `packages/docs` while `c.d2` lives under `libs/other`
- **THEN** `createNodesV2` returns one configuration for `packages/docs` carrying both per-file targets and the aggregate, and a separate configuration for `libs/other` — never duplicate configurations for the same root

### Requirement: Extension-to-type registry
The plugin MUST map `.puml`/`.plantuml`→`plantuml`, `.mmd`/`.mermaid`→`mermaid`, `.dot`/`.gv`→`graphviz`, `.d2`→`d2`, `.bpmn`→`bpmn`, `.excalidraw`→`excalidraw`. The trigger glob covers only registry extensions and `.md` — `commands` entries override the renderer per type but MUST NOT extend discovery to custom extensions.

#### Scenario: Glob-matched file without a type mapping
- **WHEN** a `.md` file matches the glob (the only trigger extension with no file-level type mapping) and contains no diagram fences
- **THEN** no target is inferred for it — per-file typing applies only to registry extensions; `.md` sources render exclusively via extracted blocks

### Requirement: Collision safety
Target names MUST disambiguate via the relative path slug. When distinct files still collide — same slug after normalization (e.g. `a-b.puml` vs `a/b.puml`) or same output path (e.g. `auth.puml` vs `auth.mmd`) — the plugin MUST add a deterministic suffix (diagram type, then a short path hash) instead of silently overwriting the earlier target or output. A `targetName` that collides with an inferred per-file target MUST fail inference with an actionable error.

#### Scenario: Duplicate basenames
- **WHEN** `a/auth.puml` and `b/auth.puml` both exist
- **THEN** distinct targets `diagram-a-auth` and `diagram-b-auth` are inferred

#### Scenario: Same basename, different types
- **WHEN** `auth.puml` and `auth.mmd` exist in the same directory
- **THEN** distinct targets are inferred and the outputs are disambiguated (e.g. `auth-plantuml.svg` and `auth-mermaid.svg`) instead of both writing `auth.svg`

### Requirement: Renderer precedence
The `render` executor MUST prefer `commands[type]` when configured, spawning the command with `{input}`, `{output}`, `{format}`, `{fileDir}`, `{fileName}`, and `{projectRoot}` placeholders interpolated; otherwise it MUST POST the diagram source to `{krokiUrl}/{type}/{format}` and write the response body bytes to the output path. Placeholder values MUST be shell-quoted during interpolation so paths with spaces or metacharacters remain single arguments; command authors MUST NOT wrap placeholders in their own quotes. `timeout` MUST be a positive number of milliseconds; non-positive values MUST fail validation before any rendering.

#### Scenario: Command override wins
- **WHEN** `commands.mermaid` is configured and a `.mmd` file renders
- **THEN** the configured command runs and no HTTP request is made

#### Scenario: Kroki default
- **WHEN** no command is configured for `plantuml`
- **THEN** the executor POSTs the file content to `{krokiUrl}/plantuml/svg` and writes the response bytes

### Requirement: Rendering failures
The executor MUST fail when a command exits non-zero (including stderr in the error) or when Kroki responds non-2xx (including a response-body snippet). If `krokiUrl` is empty and no command covers the type, it MUST fail with an actionable message.

#### Scenario: Kroki server error
- **WHEN** Kroki returns 400 with an error body
- **THEN** the executor throws an error containing the response body snippet and does not write an output file

#### Scenario: Command failure
- **WHEN** a configured command exits 1 writing to stderr
- **THEN** the executor throws an error containing the stderr text

#### Scenario: No renderer available
- **WHEN** `krokiUrl` is `""` and `commands` has no entry for the file's type
- **THEN** the executor throws telling the user to configure `commands` or set `krokiUrl`

### Requirement: Output path templating
The output path MUST be derived from `outputDir` with `{fileDir}`, `{fileName}`, and `{projectRoot}` tokens — all workspace-relative (`{fileDir}` is the source file's directory, `{projectRoot}` the owning project root, `''` for the root project) — defaulting to colocated `{fileDir}/{fileName}.{format}`. For Markdown blocks `{fileName}` is `<basename>-<n>` where `<n>` is the block's 1-based ordinal (`docs/guide.md` block 0 → `docs/guide-1.svg`); for standalone files it is the basename without extension. An `outputDir` that resolves to an absolute path or escapes the workspace via `..` MUST fail inference.

Empty token expansions MUST collapse path separators rather than leave stray slashes — `{fileDir}`/`{projectRoot}` expanding to `''` at the root yields `auth.svg`, never `/auth.svg`.

#### Scenario: Custom outputDir
- **WHEN** `outputDir` is `{projectRoot}/docs/img`
- **THEN** `packages/docs/diagrams/auth.puml` renders to `packages/docs/docs/img/auth.svg`

#### Scenario: Root-level source with default outputDir
- **WHEN** `auth.puml` sits at the workspace root and `outputDir` is the default `{fileDir}`
- **THEN** the output path is `auth.svg` — no leading separator from the empty `{fileDir}`

#### Scenario: outputDir escapes the workspace
- **WHEN** `outputDir` is `../out` or `/tmp/out`
- **THEN** inference fails with an error naming the offending `outputDir`

### Requirement: Format and URL options
`format` MUST accept `svg` (default), `png`, or `jpeg` and appear in both the output filename and the Kroki request path — actual per-type format support depends on the renderer (Kroki serves `jpeg` only for some types; unsupported combinations surface via the non-2xx failure rule). `krokiUrl` MUST be empty (disables Kroki), an absolute `http(s)` URL, or the literal `docker` (ephemeral local container, see "Ephemeral Kroki backend via docker"); trailing slashes are trimmed.

#### Scenario: png format
- **WHEN** `format: "png"`
- **THEN** the executor requests `/{type}/png` and writes a `.png` output

### Requirement: Filtering and naming options
`include`/`exclude` MUST filter matched files using glob semantics (`*`, `?`, `**`, `{a,b}`) against workspace-relative paths. `targetName` MUST rename the aggregate target (default `diagrams`). `dryRun` MUST be forwarded from plugin options to inferred targets.

#### Scenario: include filter
- **WHEN** `include` is `docs/**`
- **THEN** only diagram files under `docs/` produce targets

#### Scenario: custom targetName
- **WHEN** `targetName` is `render-diagrams`
- **THEN** the aggregate target is named `render-diagrams` instead of `diagrams`

### Requirement: dryRun writes nothing
With `dryRun: true` the executor MUST report planned outputs and MUST NOT write files, invoke renderers, or require a renderer to be configured.

#### Scenario: Dry run
- **WHEN** `dryRun` is set
- **THEN** no HTTP request is made, no command is spawned, and the filesystem is unchanged

### Requirement: init generator registers plugin JSONC-safely
The `init` generator MUST register `@nx-devkit/diagrams` in `nx.json`, dedupe string/tuple/object plugin forms, preserve comments/formatting via JSONC edits, and create `nx.json` when missing.

#### Scenario: Existing plugins preserved
- **WHEN** `nx.json` contains other plugins with comments
- **THEN** the plugin is appended and comments/formatting are byte-preserved outside the edit

### Requirement: Markdown files trigger per-block target inference
The default trigger glob MUST additionally cover `**/*.md` (case-insensitive, literal extension dot — `foo.cmd` MUST NOT match). For each matched Markdown file the plugin MUST extract fenced code blocks (backtick or `~~~` fences) whose language tag maps to a registry type — `mermaid`, `plantuml`/`puml`, `d2`, `dot`/`graphviz`, `bpmn`, `excalidraw` — and MUST infer one `diagram-<file-slug>-<n>` target per block, where `<n>` is the 1-based ordinal among diagram fences in that file. Fences with unmapped or missing language tags MUST be ignored, and a diagram-looking fence nested inside a non-diagram fence is body text, not a block. A Markdown file with zero diagram blocks MUST produce no targets — including no aggregate `diagrams` target, since aggregate eligibility requires at least one standalone diagram file or extracted block.

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
- **THEN** the aggregate target's `files` option lists `arch.md` twice, `blocks` is `[0, 1]`, and `outputs` lists `arch-1.svg` and `arch-2.svg` at the matching positions — `files[i]`/`blocks[i]`/`outputs[i]` describe one render unit. Note: `block`/`blocks` executor options are **0-based** fence ordinals, while the `<n>` suffix in target names and output filenames is **1-based** (`index + 1`) — the two bases coexist intentionally.

### Requirement: Block rendering in the render executor
When a target carries a `block` index (single mode) or a `blocks` array aligned to `files` (aggregate mode, `null` for whole-file entries), the executor MUST extract that block's source and render it with the block's fence-mapped type — via `commands[type]` or Kroki — instead of reading the file as diagram source. A `block` index outside the file's diagram blocks MUST fail with an actionable error. `block`/`blocks` values MUST be nonnegative integers, and a `blocks` array whose length differs from `files` MUST fail before any rendering. For command overrides the executor MUST write the block source to a temp file whose extension matches the type's canonical extension and pass it as `{input}`.

#### Scenario: Block rendered via Kroki
- **WHEN** a target has `file: "guide.md"`, `block: 0`, and the fence language is `mermaid`
- **THEN** the executor POSTs the block body (not the full Markdown) to `{krokiUrl}/mermaid/{format}`

#### Scenario: Stale block index
- **WHEN** a target requests `block: 2` but the file now has one diagram block
- **THEN** the executor fails naming the file and the out-of-range index

#### Scenario: Command override for a block
- **WHEN** `commands.mermaid` is configured and a mermaid block renders
- **THEN** the block body is written to a temp `.mmd` file passed as `{input}` and no HTTP request is made

### Requirement: Ephemeral Kroki backend via docker
`krokiUrl` MUST additionally accept the literal string `docker`. In this mode the executor MUST lazily start `docker run -d --rm -p 127.0.0.1::8000 <krokiImage>` on the first render that requires Kroki, resolve the mapped port via `docker port`, wait for `GET <url>/health` to succeed (bounded by `timeout`), render all Kroki-needed sources in the run against that URL, and stop the container in `finally` so it is removed (`--rm`). `krokiImage` MUST default to `yuzutech/kroki:latest` and be overridable via plugin options and target config.

#### Scenario: Docker mode render
- **WHEN** `krokiUrl` is `docker` and a `plantuml` source renders
- **THEN** the executor POSTs to `http://127.0.0.1:<mapped-port>/plantuml/{format}` and stops the container afterwards

#### Scenario: Custom image
- **WHEN** `krokiUrl` is `docker` and `krokiImage` is set to `mirror.local/kroki@sha256:abc`
- **THEN** `docker run` is invoked with `mirror.local/kroki@sha256:abc`
- **AND** when `krokiImage` is unset, `docker run` receives `yuzutech/kroki:latest`

#### Scenario: Container is shared within one run
- **WHEN** an aggregate target renders three Kroki sources with `krokiUrl: "docker"`
- **THEN** exactly one container is started and all three POSTs target the same URL

#### Scenario: Cleanup on failure
- **WHEN** a render throws mid-run in docker mode
- **THEN** the container is still stopped before the error propagates

#### Scenario: No container without Kroki work
- **WHEN** `dryRun` is set, or every source in the run has a `commands` override
- **THEN** no docker command is invoked

#### Scenario: Docker unavailable
- **WHEN** `krokiUrl` is `docker` but `docker run` fails (missing binary, daemon down, pull failure)
- **THEN** the executor fails with an error naming docker and the image

#### Scenario: Health timeout
- **WHEN** the container starts but `/health` never returns success within `timeout`
- **THEN** the executor fails naming the wait and the container is stopped

