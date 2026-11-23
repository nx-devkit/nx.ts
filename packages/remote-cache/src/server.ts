import { createHash } from 'node:crypto';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { isValidHash, resolveGrants } from './auth.ts';
import type { AuthConfig, TokenGrants } from './auth.ts';
import type { CacheBackend } from './backends/types.ts';

export type LogFn = (event: string, ctx: Record<string, unknown>) => void;

export interface RemoteCacheServerOptions extends AuthConfig {
  backend: CacheBackend;
  /** Hard cap on artifact size; PUTs above it get 413. Default 512 MiB. */
  maxArtifactBytes?: number;
  logger?: LogFn;
}

const DEFAULT_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const CACHE_RE = /^\/v1\/cache\/([^/?#]+)$/;

function text(res: ServerResponse, status: number, message: string): void {
  const body = Buffer.from(message);
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(body.byteLength),
  });
  res.end(body);
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const done = (value: Buffer | null): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > max) {
        // Stop buffering but keep the socket alive — handlePut still owes
        // the client a 413. Destroying here turns it into a reset.
        done(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => done(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  // No regex on the raw header — a crafted Authorization value is hostile input.
  const rest = header.slice(0, 6).toLowerCase() === 'bearer' ? header.slice(6) : null;
  if (rest === null || rest === '' || (rest[0] !== ' ' && rest[0] !== '\t')) return null;
  const token = rest.trim();
  return token === '' ? null : token;
}

/**
 * The Nx remote-cache OpenAPI contract:
 *
 *   PUT /v1/cache/{hash}   → 200 stored | 401 unauthenticated |
 *                            403 read-only token | 409 already exists
 *   GET /v1/cache/{hash}   → 200 application/octet-stream | 401 | 403 | 404
 *
 * CREEP-safety layers on top of the wire contract:
 *   - immutable artifacts: PUT to an existing key answers 409
 *   - token-scoped namespacing: writes land only in the token's `write`
 *     namespace; reads scan `read` namespaces in listed order
 *   - integrity: sha256 is computed at PUT, persisted by the backend,
 *     re-verified at GET, and exposed as the `X-Cache-Sha256` header
 */
export function createRemoteCacheServer(options: RemoteCacheServerOptions): Server {
  const max = options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error(`maxArtifactBytes must be a positive integer, got ${max}`);
  }
  const log: LogFn =
    options.logger ??
    ((event, ctx) => {
      process.stdout.write(`${JSON.stringify({ event, ...ctx })}\n`);
    });

  async function handlePut(
    req: IncomingMessage,
    res: ServerResponse,
    hash: string,
    grants: TokenGrants,
  ): Promise<void> {
    if (grants.write === undefined) {
      text(res, 403, 'read-only token cannot write to the cache');
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) {
      text(res, 413, 'artifact exceeds maximum size');
      return;
    }
    const body = await readBody(req, max);
    if (body === null) {
      text(res, 413, 'artifact exceeds maximum size');
      return;
    }
    const sha256 = sha256Hex(body);
    const key = `${grants.write}/${hash}`;
    const result = await options.backend.putIfAbsent(key, body, sha256);
    if (result === 'conflict') {
      log('cache.conflict', { ns: grants.write, hash });
      text(res, 409, 'artifact already exists — remote cache is immutable');
      return;
    }
    log('cache.stored', { ns: grants.write, hash, bytes: body.byteLength, sha256 });
    text(res, 200, 'stored');
  }

  async function handleGet(res: ServerResponse, hash: string, grants: TokenGrants): Promise<void> {
    if (grants.read.length === 0) {
      text(res, 403, 'token has no read access to any cache namespace');
      return;
    }
    for (const ns of grants.read) {
      const hit = await options.backend.get(`${ns}/${hash}`);
      if (hit === null) continue;
      if (hit.sha256 === null) {
        // No persisted checksum — the artifact is unverifiable, not a hit.
        // Treat as a miss so a later PUT can heal the pair.
        log('cache.unverifiable', { ns, hash, bytes: hit.body.byteLength });
        continue;
      }
      const actual = sha256Hex(hit.body);
      if (actual !== hit.sha256) {
        log('cache.integrity-failure', { ns, hash, expected: hit.sha256, actual });
        text(res, 500, 'artifact integrity check failed');
        return;
      }
      log('cache.hit', { ns, hash, bytes: hit.body.byteLength });
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(hit.body.byteLength),
        'x-cache-sha256': sha256Hex(hit.body),
      });
      res.end(hit.body);
      return;
    }
    log('cache.miss', { hash, namespaces: grants.read });
    text(res, 404, 'artifact not found');
  }

  return createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';

      if (method === 'GET' && url === '/healthz') {
        text(res, 200, 'ok');
        return;
      }

      const match = CACHE_RE.exec(url);
      if (match === null || (method !== 'PUT' && method !== 'GET')) {
        text(res, 404, 'not found');
        return;
      }
      let hash: string;
      try {
        hash = decodeURIComponent(match[1]!);
      } catch {
        text(res, 404, 'not found');
        return;
      }
      if (!isValidHash(hash)) {
        text(res, 404, 'not found');
        return;
      }

      const token = bearerToken(req);
      const grants = token === null ? null : resolveGrants(token, options);
      if (grants === null) {
        // Spec: 401 bodies are text/plain — the Nx CLI surfaces them.
        text(res, 401, 'missing or invalid authentication token');
        return;
      }

      if (method === 'PUT') await handlePut(req, res, hash, grants);
      else await handleGet(res, hash, grants);
    })().catch((err: unknown) => {
      log('cache.error', { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) text(res, 500, 'internal error');
      else res.end();
    });
  });
}
