# Proposal: @nx-devkit/diagrams — render text diagrams to images, Nx-way

## Why

Projects keep diagrams as text (PlantUML, Mermaid, Graphviz, D2, BPMN, Excalidraw) next to docs, but rendering them to images today means hand-wired scripts with no caching. An inference plugin turns every diagram file into a cached, atomized Nx target — `nx affected` renders only changed diagrams, Nx Cloud distributes the artifacts.

Kroki covers ~25 diagram types over one HTTP API and self-hosts via docker (`yuzutech/kroki`), so it is the default runtime; per-type `commands` overrides let workspaces use local CLIs (`mmdc`, `plantuml`, `dot`) for offline or private rendering.

## What Changes

### NEW package: `packages/diagrams/`

- **Scope**: `@nx-devkit/diagrams`
- **Trigger glob**: `**/*.{puml,plantuml,mmd,mermaid,dot,gv,d2,bpmn,excalidraw}` (configurable `include`/`exclude`)
- **API**: `createNodesV2` (Nx 22+ / 23+)

### Inferred targets (atomized, per diagram file)

| Target | Executor | Cache | Description |
|---|---|---|---|
| `diagram-<relpath-slug>` | `@nx-devkit/diagrams:render` | true | Render one diagram file; inputs = source file, outputs = rendered image |
| `diagrams` (aggregate) | `@nx-devkit/diagrams:render` batch mode | true | Renders all diagram files in the project; depends on nothing, one command convenience |

Per-file targets give correct cache granularity — changing one `.puml` re-renders only that file.

### Renderer resolution

Per diagram type, in order:

1. `options.commands[type]` — spawn a local command with `{input}`, `{output}`, `{format}`, `{fileDir}` placeholders
2. Kroki — `POST {krokiUrl}/{type}/{format}` with the diagram source as body, image bytes in response

If neither covers a file's type, the executor fails with an actionable error.

### Plugin options

```jsonc
{
  "plugin": "@nx-devkit/diagrams",
  "options": {
    "format": "svg",                    // svg | png | jpeg (default svg)
    "krokiUrl": "https://kroki.io",     // set to self-hosted URL or "" to disable
    "outputDir": "{fileDir}",           // tokens: {fileDir} {fileName} {projectRoot}
    "commands": { "mermaid": "mmdc -i {input} -o {output}" },
    "include": [...], "exclude": [...]
  }
}
```

### Type registry (default)

`.puml`/`.plantuml` → `plantuml`, `.mmd`/`.mermaid` → `mermaid`, `.dot`/`.gv` → `graphviz`, `.d2` → `d2`, `.bpmn` → `bpmn`, `.excalidraw` → `excalidraw`. `commands` keys are registry type names; types outside the registry are not reachable in v1.

### init generator

Registers the plugin in `nx.json` via JSONC-preserving edits (mirrors `@nx-devkit/nx-cloud` init), dedupes string/tuple/object plugin forms.

## Out of scope (v1)

- Fenced diagram blocks (e.g. ` ```mermaid `) inside Markdown files (v2)
- Built-in local-renderer modes beyond `commands` override
- `diagrams-serve` target booting a kroki docker-compose (v2 candidate)

## Release

`@nx-devkit/diagrams` publishes through the existing OIDC release workflow; requires a one-time `npm trust github` after the placeholder publish.
