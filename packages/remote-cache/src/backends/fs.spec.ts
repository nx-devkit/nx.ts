import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemBackend } from './fs.ts';

let dir: string;
let backend: FileSystemBackend;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nxrc-fs-'));
  backend = new FileSystemBackend(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('FileSystemBackend', () => {
  it('creates the storage dir lazily on put', async () => {
    const nested = join(dir, 'deep', 'cache');
    const b = new FileSystemBackend(nested);
    expect(await b.putIfAbsent('main/h1', Buffer.from('x'), 'aa')).toBe('created');
  });

  it('stores and retrieves an artifact', async () => {
    const body = Buffer.from('tar-bytes');
    await backend.putIfAbsent('main/abc123', body, 'deadbeef');
    const got = await backend.get('main/abc123');
    expect(got).not.toBeNull();
    expect(got!.body.equals(body)).toBe(true);
    expect(got!.sha256).toBe('deadbeef');
  });

  it('returns conflict instead of overwriting an existing key (immutable)', async () => {
    await backend.putIfAbsent('main/h', Buffer.from('good'), 'a1');
    const res = await backend.putIfAbsent('main/h', Buffer.from('poisoned'), 'a2');
    expect(res).toBe('conflict');
    const got = await backend.get('main/h');
    expect(got!.body.toString()).toBe('good');
  });

  it('commits exactly one of two racing writers — atomic create-only', async () => {
    const [r1, r2] = await Promise.all([
      backend.putIfAbsent('main/race', Buffer.from('writer-A'), 'sa'),
      backend.putIfAbsent('main/race', Buffer.from('writer-B'), 'sb'),
    ]);
    expect([r1, r2].sort()).toEqual(['conflict', 'created']);

    // The stored pair is one writer's complete input — never a torn mix.
    const got = await backend.get('main/race');
    expect(got).not.toBeNull();
    expect(['writer-A', 'writer-B']).toContain(got!.body.toString());
    expect(got!.sha256).toBe(got!.body.toString() === 'writer-A' ? 'sa' : 'sb');
  });

  it('keeps namespaces isolated on disk', async () => {
    await backend.putIfAbsent('main/h', Buffer.from('main-bytes'), 's1');
    await backend.putIfAbsent('pr-1/h', Buffer.from('pr-bytes'), 's2');
    expect((await backend.get('main/h'))!.body.toString()).toBe('main-bytes');
    expect((await backend.get('pr-1/h'))!.body.toString()).toBe('pr-bytes');
  });

  it('returns null for missing keys', async () => {
    expect(await backend.get('main/missing')).toBeNull();
  });

  it('rejects keys that escape the storage dir', async () => {
    await expect(backend.putIfAbsent('../evil', Buffer.from('x'), 's')).rejects.toThrow();
    await expect(backend.get('../../etc/passwd')).rejects.toThrow();
  });
});
