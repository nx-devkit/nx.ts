# @nx-devkit/diagrams

Zero-config Nx plugin that renders text-diagram sources to images — the Nx way. Every diagram file becomes a cached, atomized target: `nx affected` re-renders only changed diagrams, and Nx Cloud shares the artifacts.

![Render pipeline — rendered by this very plugin from docs/pipeline.puml](docs/pipeline.svg)

Supported types (extension → renderer type; matching is case-insensitive, `.PUML` works too):

| Extension | Type |
|---|---|
| `.puml`, `.plantuml` | `plantuml` |
| `.mmd`, `.mermaid` | `mermaid` |
| `.dot`, `.gv` | `graphviz` |
| `.d2` | `d2` |
| `.bpmn` | `bpmn` |
| `.excalidraw` | `excalidraw` |

Markdown files (`**/*.md`) are sources too: every fenced block whose language maps to a type — ` ```mermaid `, ` ```plantuml `/`puml`, ` ```d2 `, ` ```dot `/`graphviz`, ` ```bpmn `, ` ```excalidraw ` — gets its own `diagram-<slug>-<n>` target rendering to `<fileName>-<n>.<format>` next to the file, where `<n>` is the block's 1-based ordinal among diagram fences in that file:

```mermaid
graph LR
  MD[README.md] -->|"mermaid fence"| T[diagram-readme-1]
  T -->|"nx run"| SVG[README-1.svg]
```

![This very block, rendered by the plugin](README-1.svg)

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
  "inputs": ["{workspaceRoot}/packages/docs/diagrams/auth.puml"],
  "outputs": ["{workspaceRoot}/packages/docs/diagrams/auth.svg"],
  "options": { "file": "packages/docs/diagrams/auth.puml", "format": "svg", ... }
},
"diagrams": { /* aggregate: renders all of the project's diagrams */ }
```

```bash
bunx nx run docs:diagrams              # render all diagrams in the project
bunx nx run docs:diagram-diagrams-auth # render one
```

Per-file targets are the cache unit — each renders a single file, so unchanged diagrams are restored from cache. The aggregate `diagrams` target re-runs all of a project's diagrams when any of them changes (`nx affected -t diagrams`).

## Plugin options

```jsonc
{
  "plugin": "@nx-devkit/diagrams",
  "options": {
    "format": "svg",                  // svg | png | jpeg (default: svg)
    "krokiUrl": "https://kroki.io",   // or "docker" for an ephemeral local container; "" disables
    "krokiImage": "yuzutech/kroki:latest", // image used when krokiUrl is "docker"
    "outputDir": "{fileDir}",         // workspace-relative; tokens: {fileDir} {fileName} {projectRoot}
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

Command placeholders — all workspace-relative: `{input}` (source file; for Markdown blocks a materialized temp file — absolute path, named `<fileName>-<n>` with the type's canonical extension), `{output}` (target image path), `{format}`, `{fileDir}` (source file's directory), `{fileName}` (basename without extension; `<basename>-<n>` for blocks), `{projectRoot}` (owning project root — `.` for the root project in commands, so `{projectRoot}/img` resolves to `./img`; in `outputDir` templates it expands to an empty prefix). Commands run with `cwd` = workspace root.

Placeholder values expand **shell-quoted** — paths with spaces stay single arguments — so do not wrap placeholders in your own quotes. Commands are workspace-authored configuration (same trust level as `nx:run-commands`); they run through a shell so pipes and redirects work.

`outputDir` uses the same workspace-relative tokens: the default `{fileDir}` colocates output next to the source; use `{projectRoot}/img` for a per-project image directory.

## Local Kroki via docker

Public `kroki.io` is rate-limited and sends your diagram sources to a third party. Set `"krokiUrl": "docker"` and the executor runs an ephemeral Kroki stack per run — lazily on the first Kroki render, health-checked, then torn down when the run finishes. Cleanup is best-effort: a failed `docker stop` fails the run (or warns when a render error is already propagating), and a hard-killed process can leave the container running — `docker ps`/`docker stop` it manually. Nothing is meant to persist between runs; set `krokiImage` to pin a digest or point at a mirror.

Prerequisites: the `docker` CLI and a running daemon must be available on the machine executing Nx (a remote `DOCKER_HOST` is not supported — the port binds loopback on the daemon host while health probes hit the client host).

`timeout` is a **per-operation** limit, not a budget for the whole run: every docker command (including the image pull of the first run) and the health wait get their own limit, so a slow first pull does not eat the render's time — but a full run can take noticeably longer than `timeout`. A companion that is still starting makes the gateway answer `502`/`503`; the render is retried until the timeout is gone.

**Companion services.** The core image covers plantuml, graphviz, d2 and friends — mermaid, bpmn and excalidraw are companion services in upstream Kroki and are not bundled. In docker mode the executor starts the companions the rendered types need, on a per-run docker network under their type name, and points the gateway at them:

```text
docker network create kroki-<run>
docker run -d --rm --network kroki-<run> --network-alias mermaid yuzutech/kroki-mermaid:latest
docker run -d --rm -p 127.0.0.1::8000 --network kroki-<run> \
  -e KROKI_MERMAID_HOST=mermaid yuzutech/kroki:latest
```

The gateway's health check reports the companions, so the wait covers their startup. The network and every container are removed when the run ends. Override the images per type with `"companionImages": { "mermaid": "mirror.local/kroki-mermaid:2024.1" }`.

A type with a `commands` override never reaches Kroki — `commands` always win per type, and a command-only run touches Docker not at all. To render a companion type with a local tool instead of a container:

```jsonc
{ "options": { "krokiUrl": "docker", "commands": { "mermaid": "mmdc -i {input} -o {output}" } } }
```

To run a full stack yourself (for example a shared Kroki with a pinned image), use compose:

```jsonc
{ "options": { "krokiUrl": "docker", "commands": { "mermaid": "mmdc -i {input} -o {output}" } } }
```

```yaml
# docker-compose.yml
services:
  kroki:
    image: yuzutech/kroki
    ports: ["8000:8000"]
    environment:
      KROKI_MERMAID_HOST: mermaid
      KROKI_BPMN_HOST: bpmn
      KROKI_EXCALIDRAW_HOST: excalidraw
  mermaid:
    image: yuzutech/kroki-mermaid
  bpmn:
    image: yuzutech/kroki-bpmn
  excalidraw:
    image: yuzutech/kroki-excalidraw
```

Run it (`docker compose up -d`) and point the plugin at it —
`"krokiUrl": "http://localhost:8000"`. That is a *shared* stack; the
`"docker"` mode above is the serverless one (a stack per run, nothing
shared, nothing left behind).

## Committing images

Default output is colocated next to the source (`auth.puml` → `auth.svg`) so Markdown can reference it and it can be committed. If you render into `dist/`/`outputDir` build artifacts instead, gitignore them — targets are cached, so CI restores outputs from the Nx cache without re-rendering.
