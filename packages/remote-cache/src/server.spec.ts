import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemBackend } from './backends/fs.ts';
import { mintToken } from './auth.ts';
import { createRemoteCacheServer } from './server.ts';
import type { StaticToken } from './auth.ts';

const TOKENS: StaticToken[] = [
  { token: 'tok-main', write: 'main', read: ['main'] },
  { token: 'tok-ro', read: ['main'] },
  { token: 'tok-pr', write: 'pr-9', read: ['main', 'pr-9'] },
];

let dir: string;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nxrc-server-'));
  server = createRemoteCacheServer({
    backend: new FileSystemBackend(dir),
    tokens: TOKENS,
    tokenSecret: 'spec-secret',
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr !== 'object') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

function req(
  method: string,
  path: string,
  opts: { token?: string; body?: Buffer } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  return fetch(`${base}${path}`, { method, headers, ...(opts.body ? { body: opts.body } : {}) });
}

describe('health endpoint', () => {
  it('GET /healthz → 200 without auth', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
  });
});

describe('authentication', () => {
  it('PUT without a token → 401 text/plain', async () => {
    const res = await req('PUT', '/v1/cache/abc123', { body: Buffer.from('x') });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('GET without a token → 401', async () => {
    expect((await req('GET', '/v1/cache/abc123')).status).toBe(401);
  });

  it('PUT with an unknown token → 401', async () => {
    const res = await req('PUT', '/v1/cache/abc123', { token: 'wrong', body: Buffer.from('x') });
    expect(res.status).toBe(401);
  });

  it('PUT with a read-only token → 403 text/plain', async () => {
    const res = await req('PUT', '/v1/cache/abc123', { token: 'tok-ro', body: Buffer.from('x') });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('read-only');
  });
});

describe('spec-conformant PUT/GET /v1/cache/{hash}', () => {
  it('stores then retrieves an artifact', async () => {
    const body = Buffer.from('fake-tar-artifact');
    expect((await req('PUT', '/v1/cache/h1', { token: 'tok-main', body })).status).toBe(200);

    const res = await req('GET', '/v1/cache/h1', { token: 'tok-main' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/octet-stream');
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
  });

  it('serves the artifact content hash in X-Cache-Sha256', async () => {
    const body = Buffer.from('artifact-body');
    await req('PUT', '/v1/cache/h1', { token: 'tok-main', body });
    const res = await req('GET', '/v1/cache/h1', { token: 'tok-main' });
    expect(res.headers.get('x-cache-sha256')).toBe(createHash('sha256').update(body).digest('hex'));
  });

  it('returns 409 on a second PUT to the same key — immutable artifacts', async () => {
    const body = Buffer.from('first');
    expect((await req('PUT', '/v1/cache/h1', { token: 'tok-main', body })).status).toBe(200);
    const res = await req('PUT', '/v1/cache/h1', {
      token: 'tok-main',
      body: Buffer.from('overwrite'),
    });
    expect(res.status).toBe(409);
    const got = await req('GET', '/v1/cache/h1', { token: 'tok-main' });
    expect(Buffer.from(await got.arrayBuffer()).toString()).toBe('first');
  });

  it('GET missing key → 404', async () => {
    expect((await req('GET', '/v1/cache/missing', { token: 'tok-main' })).status).toBe(404);
  });

  it('rejects malformed hashes and unknown routes → 404', async () => {
    // fetch normalizes `/v1/cache/..` to `/v1/` before it leaves the
    // process; the encoded slash stays in the route and exercises
    // decodeURIComponent → isValidHash.
    expect((await req('GET', '/v1/cache/a%2Fb', { token: 'tok-main' })).status).toBe(404);
    expect((await req('GET', '/v1/cache/a/b', { token: 'tok-main' })).status).toBe(404);
    expect((await req('GET', '/nope', { token: 'tok-main' })).status).toBe(404);
  });

  it('rejects other methods → 404', async () => {
    expect((await req('DELETE', '/v1/cache/h1', { token: 'tok-main' })).status).toBe(404);
    expect((await req('POST', '/v1/cache/h1', { token: 'tok-main' })).status).toBe(404);
  });
});

describe('namespace isolation — CREEP resistance', () => {
  it('a PR token reads main artifacts (warm cache) but writes to its own namespace', async () => {
    await req('PUT', '/v1/cache/shared1', {
      token: 'tok-main',
      body: Buffer.from('main-artifact'),
    });

    // PR job reads main's artifact.
    const prRead = await req('GET', '/v1/cache/shared1', { token: 'tok-pr' });
    expect(prRead.status).toBe(200);
    expect(Buffer.from(await prRead.arrayBuffer()).toString()).toBe('main-artifact');
  });

  it('a PR token CANNOT poison a hash already in main (409 on its own ns would not exist — write lands in pr ns only)', async () => {
    await req('PUT', '/v1/cache/victim', { token: 'tok-main', body: Buffer.from('honest') });

    // Attacker on a PR writes poisoned bytes under the same hash — goes to pr-9 ns.
    const attack = await req('PUT', '/v1/cache/victim', {
      token: 'tok-pr',
      body: Buffer.from('poisoned'),
    });
    expect(attack.status).toBe(200); // allowed: it only writes the pr-9 namespace

    // main still reads its own honest artifact — poisoning failed.
    const mainRead = await req('GET', '/v1/cache/victim', { token: 'tok-main' });
    expect(Buffer.from(await mainRead.arrayBuffer()).toString()).toBe('honest');
  });

  it('reads prefer trusted namespaces listed first', async () => {
    await req('PUT', '/v1/cache/h2', { token: 'tok-main', body: Buffer.from('main') });
    await req('PUT', '/v1/cache/h2', { token: 'tok-pr', body: Buffer.from('pr-9') });
    const res = await req('GET', '/v1/cache/h2', { token: 'tok-pr' });
    // tok-pr reads ['main', 'pr-9'] — main wins, PR gets trusted artifact.
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('main');
  });

  it('a token with no read grants → 403 on GET', async () => {
    const token = mintToken({ w: 'sandbox', r: [] }, 'spec-secret');
    const res = await req('GET', '/v1/cache/h1', { token });
    expect(res.status).toBe(403);
  });
});

describe('signed tokens against a live server', () => {
  it('accepts a minted token with the configured secret', async () => {
    const token = mintToken({ w: 'pr-7', r: ['main', 'pr-7'] }, 'spec-secret');
    const res = await req('PUT', '/v1/cache/h9', { token, body: Buffer.from('x') });
    expect(res.status).toBe(200);
    expect((await req('GET', '/v1/cache/h9', { token })).status).toBe(200);
  });
});
