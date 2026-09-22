# Proposal: nx-diagrams — `krokiUrl: "docker"` ephemeral Kroki

## Why

The default renderer POSTs diagram sources to the public `https://kroki.io`. That means architecture diagrams leave the machine, CI needs internet, and the shared service can rate-limit or 500 (observed on this repo's own README render). `commands` overrides work but require installing each renderer CLI separately.

Kroki's core docker image (`yuzutech/kroki`) covers the main types (PlantUML, Graphviz, D2, …); Mermaid, BPMN, and Excalidraw need companion containers and keep using `commands` overrides or the public URL. Running the core image ephemerally — `docker run` for the duration of one executor invocation, `docker stop` in `finally` — gives offline/private rendering with zero persistent infrastructure and zero per-type installs.

## What Changes

`krokiUrl` accepts the literal value `"docker"` (in addition to `http(s)` URLs and `""`):

- The executor runs `docker run -d --rm -p 127.0.0.1::8000 <image>` lazily — on the first render that needs Kroki — waits for `GET /health` on the mapped loopback port, renders all files/blocks in the run against it, then `docker stop`s the container in `finally` (with `--rm` it self-cleans).
- Image defaults to `yuzutech/kroki:latest`; new plugin option `krokiImage` overrides it (mirrors, pinned digests).
- If `docker` is unavailable, the pull/health wait fails, or the run is interrupted, the executor fails with an actionable error.
- `dryRun` does not start a container.

## Out of scope

- A persistent `diagrams-serve` target — superseded by this design.
- Remote docker hosts — `docker run -p 127.0.0.1::8000` binds loopback on the daemon host while the executor probes loopback on the client host, so a remote `DOCKER_HOST` is unsupported. Rootless podman via socket is untested.
