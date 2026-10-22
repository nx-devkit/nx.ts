# Tasks: diagrams-companion-services

- [x] Executor: start the companion containers the rendered types need on a
      per-run docker network, with the `KROKI_<TYPE>_HOST` env
- [x] Executor: tear down the companions and the network with the gateway
- [x] Plugin: `companionImages` option (per type, default
      `yuzutech/kroki-<type>:latest`)
- [x] Executor schema: `companionImages`
- [x] Specs: the docker sequence, a custom companion image, a type the
      gateway image bundles
- [x] README: the companion services, the network, the teardown
- [x] The repository switches to `krokiUrl: "docker"` (nx.json)
- [ ] Gates: lint, format:check, test, build, e2e, check:spec, openspec validate
