# nx-diagrams

## MODIFIED Requirements

### Requirement: Ephemeral Kroki backend via docker

`krokiUrl` MUST additionally accept the literal string `docker`. In this mode the executor MUST lazily start `docker run -d --rm -p 127.0.0.1::8000 <krokiImage>` on the first render that requires Kroki, resolve the mapped port via `docker port`, wait for `GET <url>/health` to succeed (bounded by `timeout`), render all Kroki-needed sources in the run against that URL, and stop the container in `finally` so it is removed (`--rm`). `krokiImage` MUST default to `yuzutech/kroki:latest` and be overridable via plugin options and target config.

The default core image only serves the types bundled upstream (PlantUML, Graphviz, D2, and similar); Mermaid, BPMN, and Excalidraw are companion services. In docker mode the executor MUST start the companion containers the rendered types need, on a per-run docker network, under their type name (`--network-alias <type>`), and point the gateway at them (`-e KROKI_<TYPE>_HOST=<type>`). The companion image MUST default to `yuzutech/kroki-<type>:latest` and MUST be overridable per type via the `companionImages` option. The companion set MUST cover only the types the run renders through Kroki: a type with a `commands` override never reaches Kroki, and a Markdown target renders only its selected block. The health wait MUST cover the companions' startup — the gateway's own health does not prove that a companion is ready, so the executor MUST probe a conversion through the gateway for every companion before treating the stack as healthy. The network and every container MUST be removed when the run ends. A type covered by a `commands` override MUST NOT need a companion container.

#### Scenario: Docker mode render

- **WHEN** `krokiUrl` is `docker` and a `plantuml` source renders
- **THEN** the executor POSTs to `http://127.0.0.1:<mapped-port>/plantuml/{format}` and stops the container afterwards

#### Scenario: Custom image

- **WHEN** `krokiUrl` is `docker` and `krokiImage` is set to `mirror.local/kroki@sha256:abc`
- **THEN** `docker run` is invoked with `mirror.local/kroki@sha256:abc`
- **AND** when `krokiImage` is unset, `docker run` receives `yuzutech/kroki:latest`

#### Scenario: Container is shared within one run

- **WHEN** an aggregate target renders three Kroki sources of a type the gateway image bundles, with `krokiUrl: "docker"`
- **THEN** exactly one container is started and all three POSTs target the same URL
- **AND** a companion type adds exactly one companion container for the run

#### Scenario: Companion service for a companion type

- **WHEN** `krokiUrl` is `docker` and a `mermaid` source renders
- **THEN** the executor starts `yuzutech/kroki-mermaid:latest` on the per-run network with the alias `mermaid`
- **AND** the gateway is started with `KROKI_MERMAID_HOST=mermaid`

#### Scenario: No companion for a bundled type

- **WHEN** `krokiUrl` is `docker` and a `plantuml` source renders
- **THEN** no companion container is started

#### Scenario: Custom companion image

- **WHEN** `companionImages.mermaid` is set to `mirror.local/kroki-mermaid:2024.1`
- **THEN** the mermaid companion is started from `mirror.local/kroki-mermaid:2024.1`

#### Scenario: Cleanup on failure

- **WHEN** a render throws mid-run in docker mode
- **THEN** the container is still stopped before the error propagates

#### Scenario: No container without Kroki work

- **WHEN** `dryRun` is set, or every source in the run has a `commands` override
- **THEN** no docker command is invoked

#### Scenario: Docker unavailable

- **WHEN** `krokiUrl` is `docker` but a docker call fails (missing binary, daemon down, pull failure, network creation)
- **THEN** the executor fails with an error naming docker and the image

#### Scenario: Health timeout

- **WHEN** the container starts but `/health` never returns success within `timeout`
- **THEN** the executor fails naming the wait and the container is stopped
