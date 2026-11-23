# @nx-devkit/remote-cache

CREEP-safe self-hosted Nx remote cache — a minimal server + client implementing the [Nx remote-cache OpenAPI specification](https://nx.dev/docs/guides/tasks--caching/self-hosted-caching).

Nx deprecated all self-hosted cache packages (`@nx/s3-cache`, `@nx/gcs-cache`, `@nx/azure-cache`, `@nx/shared-fs-cache`) because of the CREEP vulnerability ([CVE-2025-36852](https://github.com/advisories/GHSA-w6m5-gf2w-vf8h)): shared-credential buckets allow PR-level cache poisoning **by design** — any CI job that can write can overwrite every key. This package is the supported-shape replacement: same S3/R2 storage, but the wire contract forbids overwrites and tokens are scoped to namespaces so untrusted jobs cannot touch `main`'s artifacts.

## Install & run

```bash
bun add -D @nx-devkit/remote-cache   # or: docker build -t nx-remote-cache packages/remote-cache

export NXRC_BACKEND=fs
export NXRC_FS_DIR=/var/cache/nx
export NXRC_TOKENS='[
  { "token": "ci-main-token", "write": "main", "read": ["main"] },
  { "token": "ci-pr-token",   "write": "pr",   "read": ["main", "pr"] }
]'

bunx nx-remote-cache serve          # listens on :3000
```

Point Nx at it (no plugin, no tasks runner — the native client is built in):

```bash
export NX_SELF_HOSTED_REMOTE_CACHE_SERVER=https://cache.internal:3000
export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN=ci-main-token
bunx nx run-many -t build
```

## The wire contract

| Route                  | Semantics                                                              |
| ---------------------- | ---------------------------------------------------------------------- |
| `PUT /v1/cache/{hash}` | `200` stored · `401` bad token · `403` read-only token · `409` exists  |
| `GET /v1/cache/{hash}` | `200` `application/octet-stream` · `401` · `403` no read grant · `404` |
| `GET /healthz`         | `200` unauthenticated probe endpoint                                   |

PUT bodies and successful GET responses are `application/octet-stream` tar artifacts, exactly as the Nx native client produces/consumes; errors and `/healthz` respond `text/plain`.

## Threat model — why this resists CREEP

The vulnerability in the deprecated packages: every CI job shared **one writable bucket**. A job running attacker-controlled code from a PR could overwrite any key — including keys `main` jobs would later read — with a poisoned artifact. Three layers close that:

1. **Immutable artifacts.** `PUT` to an existing key answers `409 Conflict`. No writer — trusted or not — can replace an artifact once stored. A poisoned upload cannot silently overwrite a good one; first writer wins and the first writer for a `main` hash is always a `main` job.

2. **Token-scoped namespacing.** Every token is bound to exactly one _write_ namespace and an ordered list of _read_ namespaces. Storage keys are `<write-namespace>/<hash>`. A PR job's token writes into `pr` (or `pr-<n>`) and reads `["main", "pr"]` — it gets a warm cache from `main` but structurally cannot put bytes where `main` looks. Reads scan the listed namespaces in order, so put trusted namespaces first.

3. **Content-hash verification.** The server computes `sha256(body)` at PUT, persists it in backend metadata, re-verifies it on every GET (mismatch → `500`, fail loud — a tampered backend is detected, not served), and announces it to clients via `X-Cache-Sha256`. `RemoteCacheClient` verifies that header on reads.

What this does **not** solve: a shared `pr` namespace lets one PR poison _another_ PR's reads. Deploy per-PR namespaces via minted tokens (below) to eliminate that; even without it, `main` is never affected.

### Signed per-PR tokens (`nxrc1.`)

Static tokens cover steady-state CI. For per-PR isolation, a _trusted controller_ (merge bot, workflow on `pull_request_target`) mints short-lived tokens — the PR job itself never sees the signing secret:

```bash
export NXRC_TOKEN_SECRET=<hmac-secret>            # configured on the server too
bunx nx-remote-cache mint --write pr-123 --read main,pr-123 --ttl 3600
# → nxrc1.<claims>.<hmac-sha256>   hand this to the PR job
```

Claims are `{ w, r, exp }` HMAC-SHA256-signed. An attacker holding a PR token cannot mint a `main` token — they don't have the secret.

## Configuration

All env vars, or a JSON file via `--config` — camelCase keys with a nested `backend` object, e.g. `{"port": 3000, "backend": {"type": "s3", "bucket": "cache", "region": "eu-1", "accessKeyId": "...", "secretAccessKey": "..."}, "tokens": [...]}`. Env form:

| Variable                                                            | Default             | Purpose                                 |
| ------------------------------------------------------------------- | ------------------- | --------------------------------------- |
| `NXRC_PORT` / `NXRC_HOST`                                           | `3000` / `0.0.0.0`  | listen address                          |
| `NXRC_BACKEND`                                                      | `fs`                | `fs` or `s3`                            |
| `NXRC_FS_DIR`                                                       | `./nx-remote-cache` | fs storage directory                    |
| `NXRC_S3_BUCKET`                                                    | —                   | bucket (required for `s3`)              |
| `NXRC_S3_ENDPOINT`                                                  | AWS                 | custom endpoint (R2/MinIO → path-style) |
| `NXRC_S3_REGION`                                                    | `us-east-1`         | signing region (`auto` for R2)          |
| `NXRC_S3_PREFIX`                                                    | —                   | key prefix                              |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | —                   | S3 credentials                          |
| `NXRC_TOKENS`                                                       | —                   | inline JSON array of tokens             |
| `NXRC_TOKENS_FILE`                                                  | —                   | path to JSON token file                 |
| `NXRC_TOKEN_SECRET`                                                 | —                   | HMAC secret enabling `nxrc1.` tokens    |
| `NXRC_MAX_ARTIFACT_BYTES`                                           | `512MiB`            | PUT cap → `413`                         |

## Backends

**`fs`** (default): `<dir>/<namespace>/<hash>` + `<hash>.sha256` sidecar. Create-only via atomic `link(2)` — a staged temp file is linked into place; `EEXIST` → `409`. A reader can never observe a half-written artifact.

**`s3`/`r2`**: immutability via S3 conditional writes — `PUT` sends `If-None-Match: *` (supported by AWS S3 and Cloudflare R2); `412` maps to `409`. Integrity hash stored in `x-amz-meta-sha256` object metadata. Path-style when `endpoint` is set (R2/MinIO), virtual-hosted for AWS. SigV4 is signed internally — no AWS SDK dependency.

## Container

```bash
docker build -t nx-remote-cache -f Dockerfile .
docker run -p 3000:3000 -v nxrc:/cache \
  -e NXRC_FS_DIR=/cache -e NXRC_TOKENS="$TOKENS_JSON" nx-remote-cache
```

Single stage, Node ≥ 22, zero runtime dependencies — the image is the package's `dist` plus `node dist/cli.mjs serve`.

## Library API

```ts
import {
  createRemoteCacheServer,
  FileSystemBackend,
  RemoteCacheClient,
} from '@nx-devkit/remote-cache';

const server = createRemoteCacheServer({
  backend: new FileSystemBackend('/cache'),
  tokens: [{ token: 't', write: 'main', read: ['main'] }],
  tokenSecret: 'hmac-secret',
});
server.listen(3000);

const client = new RemoteCacheClient('https://cache:3000', 't');
await client.store(hash, tarBytes); // 'stored' | 'conflict'
const bytes = await client.retrieve(hash); // Buffer | null, sha256-verified
```

`nx-remote-cache put <hash> <file>` / `get <hash> [file]` wrap the client for smoke tests.
