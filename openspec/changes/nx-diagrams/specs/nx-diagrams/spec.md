# nx-diagrams Specification

## Purpose
Renders text-diagram source files (PlantUML, Mermaid, Graphviz, D2, BPMN, Excalidraw, …) to images as cached, atomized Nx targets. Kroki is the default rendering backend; per-type shell commands override it for offline or private rendering.

## ADDED Requirements

### Requirement: Diagram files trigger per-file target inference
The plugin MUST use `createNodesV2` with a default trigger glob covering `**/*.{puml,plantuml,mmd,mermaid,dot,gv,d2,bpmn,excalidraw}` and MUST infer one `diagram-<relpath-slug>` target per matched file on the owning project, plus a `diagrams` aggregate target on projects containing at least one match.

#### Scenario: Single diagram file
- **WHEN** `packages/docs/diagrams/auth.puml` exists
- **THEN** the owning project gets a `diagram-docs-diagrams-auth` target with `cache: true`, `inputs` containing the source file, `outputs` containing the rendered image path, and executor `@nx-devkit/diagrams:render`

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

### Requirement: Basename collision safety
When two diagram files share a basename, target names MUST disambiguate via the relative path slug, not a hash.

#### Scenario: Duplicate basenames
- **WHEN** `a/auth.puml` and `b/auth.puml` both exist
- **THEN** distinct targets `diagram-a-auth` and `diagram-b-auth` are inferred

### Requirement: Renderer precedence
The `render` executor MUST prefer `commands[type]` when configured, spawning the command with `{input}`, `{output}`, `{format}`, and `{fileDir}` placeholders interpolated; otherwise it MUST POST the diagram source to `{krokiUrl}/{type}/{format}` and write the response body bytes to the output path.

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
The output path MUST be derived from `outputDir` with `{fileDir}`, `{fileName}`, and `{projectRoot}` tokens, defaulting to colocated `{fileDir}/{fileName}.{format}`.

#### Scenario: Custom outputDir
- **WHEN** `outputDir` is `docs/img`
- **THEN** `packages/docs/diagrams/auth.puml` renders to `packages/docs/docs/img/auth.svg` resolved under the project root

### Requirement: Format and URL options
`format` MUST accept `svg` (default), `png`, or `jpeg` and appear in both the output filename and the Kroki request path. `krokiUrl` MUST be an absolute `http(s)` URL; trailing slashes are trimmed.

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
