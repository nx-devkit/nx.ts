# Tasks

- [x] render executor: `krokiUrl === 'docker'` → lazy `docker run -d --rm -p 127.0.0.1::8000`, `docker port` for the mapped port, poll `/health` until 200 or timeout, `docker stop` in `finally`
- [x] `krokiImage` option (default `yuzutech/kroki:latest`) in plugin options + executor schema
- [x] errors: docker missing / run failure / health timeout → actionable messages
- [x] Tests: spawn-mocked docker lifecycle (start args, port parse, health poll, stop on success and on failure), no container for dryRun/commands-only runs
- [x] schema.json + schema.d.ts + README + plugin option docs + AGENTS.md
- [x] Verify: `bunx vitest run` (86/86), typecheck, format:check, check:spec, openspec validate
