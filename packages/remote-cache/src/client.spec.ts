import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemBackend } from './backends/fs.ts';
import { RemoteCacheClient } from './client.ts';
import { createRemoteCacheServer } from './server.ts';

let dir: string;
let server: Server;
let client: RemoteCacheClient;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nxrc-client-'));
  server = createRemoteCacheServer({
    backend: new FileSystemBackend(dir),
    tokens: [{ token: 'tok', write: 'main', read: ['main'] }],
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr !== 'object') throw new Error('no address');
  client = new RemoteCacheClient(`http://127.0.0.1:${addr.port}`, 'tok');
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

describe('RemoteCacheClient', () => {
  it('stores and retrieves artifacts', async () => {
    const body = Buffer.from('artifact');
    expect(await client.store('h1', body)).toBe('stored');
    const got = await client.retrieve('h1');
    expect(got).not.toBeNull();
    expect(got!.equals(body)).toBe(true);
  });

  it('returns conflict on a duplicate store', async () => {
    await client.store('h1', Buffer.from('a'));
    expect(await client.store('h1', Buffer.from('b'))).toBe('conflict');
  });

  it('returns null on a miss', async () => {
    expect(await client.retrieve('missing')).toBeNull();
  });

  it('throws on auth failure', async () => {
    const bad = new RemoteCacheClient(client.baseUrl, 'wrong');
    await expect(bad.retrieve('h1')).rejects.toThrow(/401/);
    await expect(bad.store('h1', Buffer.from('x'))).rejects.toThrow(/401/);
  });

  it('detects a corrupted payload via X-Cache-Sha256', async () => {
    const tamperingFetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const res = await fetch(input, init);
      if (res.status === 200 && String(input).includes('/v1/cache/')) {
        // Strip integrity header but corrupt nothing else? No — corrupt the body.
        return new Response('tampered', { status: 200, headers: res.headers });
      }
      return res;
    }) as typeof fetch;
    const body = Buffer.from('real');
    await client.store('h2', body);
    const c = new RemoteCacheClient(client.baseUrl, 'tok', tamperingFetch);
    await expect(c.retrieve('h2')).rejects.toThrow(/sha256|integrity/i);
  });

  it('accepts base URLs with a trailing slash', async () => {
    const c = new RemoteCacheClient(`${client.baseUrl}/`, 'tok');
    await c.store('h3', Buffer.from('x'));
    expect((await c.retrieve('h3'))!.toString()).toBe('x');
  });

  it('verifies sha256 header matches the returned bytes on success', async () => {
    const body = Buffer.from('checkme');
    await client.store('h4', body);
    const expected = createHash('sha256').update(body).digest('hex');
    const got = await client.retrieve('h4');
    expect(got).not.toBeNull();
    expect(createHash('sha256').update(got!).digest('hex')).toBe(expected);
  });
});
