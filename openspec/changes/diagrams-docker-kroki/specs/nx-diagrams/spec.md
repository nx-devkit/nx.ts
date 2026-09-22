# nx-diagrams Specification — ephemeral Kroki via docker delta

## ADDED Requirements

### Requirement: Ephemeral Kroki backend via docker
`krokiUrl` MUST additionally accept the literal string `docker`. In this mode the executor MUST lazily start `docker run -d --rm -p 127.0.0.1::8000 <krokiImage>` on the first render that requires Kroki, resolve the mapped port via `docker port`, wait for `GET <url>/health` to succeed (bounded by `timeout`), render all Kroki-needed sources in the run against that URL, and stop the container in `finally` so it is removed (`--rm`). `krokiImage` MUST default to `yuzutech/kroki:latest` and be overridable via plugin options and target config.

#### Scenario: Docker mode render
- **WHEN** `krokiUrl` is `docker` and a `mermaid` source renders
- **THEN** the executor POSTs to `http://127.0.0.1:<mapped-port>/mermaid/{format}` and stops the container afterwards

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
