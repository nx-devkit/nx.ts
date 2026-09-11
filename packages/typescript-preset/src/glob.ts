import { glob } from 'node:fs/promises'

/**
 * Check if any file in `rootDir` matches the given glob pattern.
 * Uses Node.js built-in `fs.glob` (Node 22+) with async I/O.
 */
export async function globMatch(rootDir: string, pattern: string): Promise<boolean> {
  try {
    for await (const _ of glob(pattern, { cwd: rootDir })) {
      return true
    }
    return false
  } catch {
    return false
  }
}
