/**
 * Storage backend contract. Keys are composite `<namespace>/<hash>` —
 * the server builds them from validated parts, backends treat them as
 * opaque paths.
 */

export interface StoredArtifact {
  body: Buffer;
  /** Integrity hash recorded at put time; null when the backend has none. */
  sha256: string | null;
}

export type PutResult = 'created' | 'conflict';

export interface CacheBackend {
  /**
   * Create-only write. MUST NOT overwrite an existing key — returns
   * 'conflict' when the key already exists. Immutability is the core
   * CREEP defense: no writer can replace a good artifact with a
   * poisoned one after the fact.
   */
  putIfAbsent(key: string, body: Buffer, sha256: string): Promise<PutResult>;

  /** Fetch an artifact, or null when the key does not exist. */
  get(key: string): Promise<StoredArtifact | null>;
}
