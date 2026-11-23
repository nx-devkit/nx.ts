# @nx-devkit/remote-cache

Agent guide for working in `packages/remote-cache/`. Touch ONLY this
directory unless the bead body says otherwise.

## What this package is

A **server + client**, not an Nx inference plugin — there is no
`plugin.ts`, `executors.json`, or `generators.json`. It implements the Nx
remote-cache OpenAPI spec (`PUT`/`GET /v1/cache/{hash}`, bearer auth) which
the Nx native binary (`NX_SELF_HOSTED_REMOTE_CACHE_SERVER`) speaks
directly. Zero runtime dependencies: `node:http` server, hand-rolled
SigV4 for S3.

## File layout

```text
packages/remote-cache/
├── package.json
├── tsdown.config.ts        # entries: index, cli
├── vitest.config.ts
├── tsconfig.json
├── Dockerfile              # single-container deploy target
├── src/
│   ├── index.ts            # public surface
│   ├── cli.ts              # nx-remote-cache serve|mint|get|put
│   ├── server.ts           # http.Server + route handling
│   ├── auth.ts             # static tokens + signed nxrc1. tokens
│   ├── config.ts           # env/file config → RemoteCacheConfig
│   ├── client.ts           # spec-conformant client
│   ├── sigv4.ts            # AWS SigV4 signer (no SDK)
│   └── backends/
│       ├── types.ts        # CacheBackend contract
│       ├── fs.ts           # atomic link(2) create-only
│       └── s3.ts           # If-None-Match conditional PUT + meta sha256
└── *.spec.ts               # vitest, colocated
```

## Invariants — do not break these

- **Immutability.** `putIfAbsent` must never overwrite. fs: atomic
  `link(2)` (EEXIST → conflict). S3: `If-None-Match: *` (412 → conflict).
  A get-then-put fallback is NOT acceptable — it reintroduces the race.
- **Namespacing is credential-derived.** The URL path is fixed by the Nx
  spec (`/v1/cache/{hash}`) — the _token alone_ selects write namespace
  and read order. Never add a path/query namespace the Nx client can't
  send.
- **One write namespace per token.** `write` is a single string, not a
  list — multi-namespace writes would be ambiguous.
- **Read order is priority order.** `read` namespaces scan first-to-last;
  documented guidance is trusted namespaces first.
- **Integrity.** sha256 computed at PUT, persisted by the backend,
  re-verified at GET (mismatch → 500, fail loud), exposed as
  `X-Cache-Sha256` and verified by `RemoteCacheClient`.
- **401 bodies are `text/plain`** — the Nx CLI surfaces them to users.
- **No dependencies.** Keep it deployable as `node dist/cli.mjs` in a
  bare Node 22 image. If a feature seems to need a dependency, prefer
  implementing the narrow slice (see `sigv4.ts`).

## TDD workflow

1. Failing `src/**/*.spec.ts` first — `mkdtempSync` for fs backend, real
   `server.listen(0)` for HTTP tests, `fetchImpl` injection for S3.
2. `bun run test` → RED → implement → GREEN.
3. `bun run build`; `npx tsc --noEmit -p tsconfig.json` (tsdown doesn't
   typecheck).
4. Commit.

## Verification commands

```bash
cd packages/remote-cache
bun run test
bun run build
npx tsc --noEmit -p tsconfig.json
```
