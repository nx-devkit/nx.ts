import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, link, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { CacheBackend, PutResult, StoredArtifact } from './types.ts';

/**
 * Filesystem backend — default for a single-container deployment.
 *
 * Artifacts land at `<dir>/<namespace>/<hash>` with a sibling
 * `<dir>/<namespace>/<hash>.sha256` sidecar recording the integrity hash.
 *
 * Create-only semantics are atomic: the body is staged to a temp file and
 * then hard-linked into place. `link(2)` fails EEXIST when the destination
 * exists, so a racing writer can never replace an artifact mid-serve and
 * a second PUT deterministically sees 'conflict'.
 */
export class FileSystemBackend implements CacheBackend {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  private pathFor(key: string): string {
    const p = resolve(this.dir, key);
    if (p !== this.dir && !p.startsWith(this.dir + sep)) {
      throw new Error(`cache key escapes storage dir: ${JSON.stringify(key)}`);
    }
    return p;
  }

  async putIfAbsent(key: string, body: Buffer, sha256: string): Promise<PutResult> {
    const dest = this.pathFor(key);
    await mkdir(dirname(dest), { recursive: true });

    const tmpBody = join(dirname(dest), `.tmp-${process.pid}-${randomUUID()}`);
    const tmpSide = `${tmpBody}.sha256`;
    try {
      await writeFile(tmpBody, body);
      await writeFile(tmpSide, sha256);

      // Link the sidecar first; a GET that finds the artifact must also
      // find its integrity record.
      try {
        await link(tmpSide, `${dest}.sha256`);
      } catch (err) {
        if (isAlreadyExists(err)) return 'conflict';
        throw err;
      }
      try {
        await link(tmpBody, dest);
      } catch (err) {
        await rm(`${dest}.sha256`, { force: true }).catch(() => undefined);
        if (isAlreadyExists(err)) return 'conflict';
        throw err;
      }
      return 'created';
    } finally {
      await rm(tmpBody, { force: true }).catch(() => undefined);
      await rm(tmpSide, { force: true }).catch(() => undefined);
    }
  }

  async get(key: string): Promise<StoredArtifact | null> {
    const dest = this.pathFor(key);
    const fh = await open(dest, 'r').catch((err: unknown) => {
      if (isNotFound(err)) return null;
      throw err;
    });
    if (fh === null) return null;
    try {
      const body = await fh.readFile();
      const sha256 = await readFile(`${dest}.sha256`, 'utf8')
        .then((s) => s.trim())
        .catch(() => null);
      return { body, sha256 };
    } finally {
      await fh.close();
    }
  }
}

function isAlreadyExists(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'EEXIST'
  );
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
