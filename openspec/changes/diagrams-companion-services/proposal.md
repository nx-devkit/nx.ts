# Proposal: diagrams-companion-services

## Why

The `krokiUrl: "docker"` mode of `@nx-devkit/diagrams` starts only the Kroki
gateway image (`yuzutech/kroki`). That image bundles PlantUML, Graphviz and
D2 — **mermaid, bpmn and excalidraw are separate companion services** in
upstream Kroki. The executor therefore could not render a `.mmd` diagram
locally: the spec had to route those types through `commands` overrides
(`mmdc`) or a hand-rolled compose stack.

Two consequences:

1. The repository's own diagrams are `.mmd` — with the public `kroki.io`
   backend they are **sent to a third party** on every render, and the
   repository's CI depends on that public service being up (it is currently
   answering `HTTP 500` for every mermaid diagram, which fails the
   `Render diagrams` step of every open PR).
2. Consumers who want a local backend for everything cannot get it without
   running their own stack.

## What changes

- `packages/diagrams`: the docker mode starts the **companion containers the
  rendered types need** — on a per-run docker network, under their type name,
  with the gateway told where to find them (`KROKI_MERMAID_HOST=mermaid`).
  The gateway health check reports its companions, so the wait covers their
  startup. The network and every container are removed when the run ends.
- New plugin option `companionImages` (per type, default
  `yuzutech/kroki-<type>:latest`).
- The repository switches its diagrams plugin to `"krokiUrl": "docker"` — the
  diagram sources stay on the machine, and the CI step no longer depends on
  the public service.

## Non-goals

- No change to the public `kroki.io` backend or its default.
- No new diagram types.
