# @nx-devkit/diagrams

Zero-config Nx plugin that renders text-diagram sources to images — the Nx way. Every diagram file becomes a cached, atomized target: `nx affected` re-renders only changed diagrams, and Nx Cloud shares the artifacts.

Supported types (extension → renderer type):

| Extension | Type |
|---|---|
| `.puml`, `.plantuml` | `plantuml` |
| `.mmd`, `.mermaid` | `mermaid` |
| `.dot`, `.gv` | `graphviz` |
| `.d2` | `d2` |
| `.bpmn` | `bpmn` |
| `.excalidraw` | `excalidraw` |

## Setup

```bash
bun add -D @nx-devkit/diagrams   # or npm/pnpm/yarn
bunx nx g @nx-devkit/diagrams:init
```

Or register manually in `nx.json`:

```jsonc
{
  "plugins": [
    { "plugin": "@nx-devkit/diagrams", "options": {} }
  ]
}
```

## What you get

For `packages/docs/diagrams/auth.puml` inside project `packages/docs`:

```jsonc
"diagram-diagrams-auth": {
  "executor": "@nx-devkit/diagrams:render",
  "cache": true,
  "inputs": [{ "file": "packages/docs/diagrams/auth.puml" }],
  "outputs": ["packages/docs/diagrams/auth.svg"],
  "options": { "file": "packages/docs/diagrams/auth.puml", "format": "svg", ... }
},
"diagrams": { /* aggregate: renders all of the project's diagrams */ }
```

```bash
bunx nx run docs:diagrams              # render all diagrams in the project
bunx nx run docs:diagram-diagrams-auth # render one
bunx nx affected -t diagrams           # render only changed diagrams
```

## Plugin options

```jsonc
{
  "plugin": "@nx-devkit/diagrams",
  "options": {
    "format": "svg",                  // svg | png | jpeg (default: svg)
    "krokiUrl": "https://kroki.io",   // self-host for privacy/offline; "" disables
    "outputDir": "{fileDir}",         // tokens: {fileDir} {fileName} {projectRoot}
    "targetName": "diagrams",         // aggregate target name
    "include": ["docs/**"],           // extra filters over matched files
    "exclude": ["**/vendor/**"],
    "commands": {
      // per-type local renderers — win over Kroki when set
      "mermaid": "mmdc -i {input} -o {output}",
      "plantuml": "plantuml -t{format} {input} -o {fileDir}",
      "graphviz": "dot -T{format} {input} -o {output}"
    }
  }
}
```

Command placeholders: `{input}` (source file, workspace-relative), `{output}` (target image path), `{format}`, `{fileDir}`, `{fileName}`, `{projectRoot}`. Commands run with `cwd` = workspace root.

## Self-hosted Kroki

Public `kroki.io` is rate-limited and sends your diagram sources to a third party. For CI or private diagrams run Kroki in docker — the official images are `yuzutech/kroki` (core: plantuml, graphviz, d2, …) plus companions `yuzutech/kroki-mermaid`, `kroki-bpmn`, `kroki-excalidraw`:

```yaml
# docker-compose.yml
services:
  kroki:
    image: yuzutech/kroki
    ports: ["8000:8000"]
    environment:
      KROKI_MERMAID_HOST: mermaid
  mermaid:
    image: yuzutech/kroki-mermaid
```

Then `"krokiUrl": "http://localhost:8000"`.

## Committing images

Default output is colocated next to the source (`auth.puml` → `auth.svg`) so Markdown can reference it and it can be committed. If you render into `dist/`/`outputDir` build artifacts instead, gitignore them — targets are cached, so CI restores outputs from the Nx cache without re-rendering.
