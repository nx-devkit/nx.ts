# nx-diagrams Specification

## Purpose
Renders text-diagram source files (PlantUML, Mermaid, Graphviz, D2, BPMN, Excalidraw, …) to images as cached, atomized Nx targets. Kroki is the default rendering backend; per-type shell commands override it for offline or private rendering.

## ADDED Requirements

### Requirement: Diagram files trigger per-file target inference
The plugin MUST use `createNodesV2` with a default trigger glob covering `**/*.{puml,plantuml,mmd,mermaid,dot,gv,d2,bpmn,excalidraw}` and MUST infer one `diagram-<relpath-slug>` target per matched file on the owning project, plus a `diagrams` aggregate target on projects containing at least one match.

#### Scenario: Single diagram file
- **WHEN** `packages/docs/diagrams/auth.puml` exists in project `packages/docs`
- **THEN** the owning project gets a `diagram-diagrams-auth` target (slug from the project-relative path) with `cache: true`, `inputs` containing the source file, `outputs` containing the rendered image path, and executor `@nx-devkit/diagrams:render`

#### Scenario: Aggregate target
- **WHEN** a project contains at least one diagram file
- **THEN** it also gets a `diagrams` target running the render executor over all of the project's diagram files

#### Scenario: No diagrams
- **WHEN** a project contains no matched files
- **THEN** no diagram targets are inferred for it

### Requirement: Extension-to-type registry
The plugin MUST map `.puml`/`.plantuml`→`plantuml`, `.mmd`/`.mermaid`→`mermaid`, `.dot`/`.gv`→`graphviz`, `.d2`→`d2`, `.bpmn`→`bpmn`, `.excalidraw`→`excalidraw`. Files with no registry mapping and no matching `commands` entry MUST be skipped by inference.

#### Scenario: Unmapped extension ignored
- **WHEN** a file matches the glob but has no type mapping and no `commands` entry
- **THEN** no target is inferred for it

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
The output path MUST be derived from `outputDir` with `{fileDir}`, `{fileName}`, and `{projectRoot}` tokens — all workspace-relative (`{fileDir}` is the source file's directory, `{projectRoot}` the owning project root, `''` for the root project) — defaulting to colocated `{fileDir}/{fileName}.{format}`. An `outputDir` that resolves to an absolute path or escapes the workspace via `..` MUST fail inference.

#### Scenario: Custom outputDir
- **WHEN** `outputDir` is `{projectRoot}/docs/img`
- **THEN** `packages/docs/diagrams/auth.puml` renders to `packages/docs/docs/img/auth.svg`

#### Scenario: outputDir escapes the workspace
- **WHEN** `outputDir` is `../out` or `/tmp/out`
- **THEN** inference fails with an error naming the offending `outputDir`

### Requirement: Format and URL options
`format` MUST accept `svg` (default), `png`, or `jpeg` and appear in both the output filename and the Kroki request path — actual per-type format support depends on the renderer (Kroki serves `jpeg` only for some types; unsupported combinations surface via the non-2xx failure rule). `krokiUrl` MUST be an absolute `http(s)` URL; trailing slashes are trimmed.

#### Scenario: png format
- **WHEN** `format: "png"`
- **THEN** outputs end in `.png` and Kroki requests use `/png`

### Requirement: dryRun writes nothing
With `dryRun: true` the executor MUST report planned outputs and MUST NOT write files or invoke renderers.

#### Scenario: Dry run
- **WHEN** `dryRun` is set
- **THEN** no HTTP request is made, no command is spawned, and the filesystem is unchanged

### Requirement: init generator registers plugin JSONC-safely
The `init` generator MUST register `@nx-devkit/diagrams` in `nx.json`, dedupe string/tuple/object plugin forms, preserve comments/formatting via JSONC edits, and create `nx.json` when missing.

#### Scenario: Existing plugins preserved
- **WHEN** `nx.json` contains other plugins with comments
- **THEN** the plugin is appended and comments/formatting are byte-preserved outside the edit
