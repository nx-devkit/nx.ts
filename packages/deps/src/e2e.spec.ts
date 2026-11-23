import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Acceptance e2e (issue #227): a fixture with drifting versions must fail
// Deps:check and pass after deps:fix — verified by running the real CLIs the
// inferred targets invoke (`npx syncpack lint` / `npx syncpack fix` /
// `npx manypkg check`).

const require = createRequire(import.meta.url);

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'deps-e2e-'));
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'fixture',
      private: true,
      workspaces: ['packages/*'],
    }),
    // Manypkg only discovers workspaces when a lockfile identifies the tool.
    'bun.lock': '',
    'packages/a/package.json': JSON.stringify({
      name: 'a',
      version: '1.0.0',
      dependencies: { lodash: '4.17.20' },
    }),
    'packages/b/package.json': JSON.stringify({
      name: 'b',
      version: '1.0.0',
      dependencies: { lodash: '4.17.21' },
    }),
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function run(binPath: string, args: string[], cwd: string): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [binPath, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('deps targets e2e (real CLIs)', () => {
  it(
    'syncpack lint fails on drifting versions and passes after syncpack fix',
    { timeout: 60_000 },
    () => {
      const root = makeFixture();
      const syncpack = require.resolve('syncpack/index.cjs');

      const before = run(syncpack, ['lint'], root);
      expect(before.status).not.toBe(0);

      const fix = run(syncpack, ['fix'], root);
      expect(fix.status).toBe(0);

      const after = run(syncpack, ['lint'], root);
      expect(after.status).toBe(0);
    },
  );

  it('manypkg check flags the drifted fixture (fallback backend)', { timeout: 60_000 }, () => {
    const root = makeFixture();
    // The bin is not in the package "exports" map — locate it via package.json.
    const manypkg = join(dirname(require.resolve('@manypkg/cli/package.json')), 'bin.js');

    const result = run(manypkg, ['check'], root);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/range|mismatch|invalid/i);
  });
});
