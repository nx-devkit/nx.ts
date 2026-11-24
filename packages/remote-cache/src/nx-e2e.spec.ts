import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemBackend } from './backends/fs.ts';
import { createRemoteCacheServer } from './server.ts';
import type { LogFn } from './server.ts';

/**
 * Real-Nx end-to-end: a genuine `nx run` subprocess uploads to and restores
 * from this server over `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` — the exact
 * integration surface the OpenAPI contract promises. Unit specs only exercise
 * RemoteCacheClient and raw HTTP; this one guards the native Nx client.
 *
 * The fixture workspace borrows the monorepo's nx via a node_modules symlink,
 * so the subprocess behaves like a local install (a missing local nx makes
 * the bin exit early with "Could not find Nx modules").
 */

const require = createRequire(import.meta.url);
// Async spawn — the server under test is in-process; a sync spawn would
// block the event loop and deadlock nx's HTTP requests against it.
const execFileAsync = promisify(execFile);

function resolveNxBin(): string | null {
  try {
    return join(dirname(require.resolve('nx/package.json')), 'dist', 'bin', 'nx.js');
  } catch {
    return null;
  }
}
const nxBin = resolveNxBin();

type ServerEvent = { event: string; [key: string]: unknown };

let storeDir: string;
let workspace: string;
let marker: string;
let server: Server;
let base: string;
let events: ServerEvent[];

const BUILD_JS = `const fs = require('node:fs');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/out.txt', 'hello-from-build\\n');
fs.appendFileSync(process.env.BUILD_MARKER, 'ran\\n');
console.log('app build ran');
`;

function nxEnv(): Record<string, string> {
  // Strip inherited NX_* — a test invoked under `nx run` otherwise leaks
  // task-runner state (hashes, cloud tokens) into the fixture workspace.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('NX_')) env[key] = value;
  }
  env.NX_SELF_HOSTED_REMOTE_CACHE_SERVER = base;
  env.NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN = 'tok';
  env.NX_DAEMON = 'false';
  env.CI = 'true';
  env.BUILD_MARKER = marker;
  return env;
}

async function runNx(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [nxBin!, ...args], {
    cwd: workspace,
    env: nxEnv(),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

function markerRuns(): number {
  return readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean).length;
}

beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), 'nxrc-e2e-'));
  storeDir = join(root, 'store');
  workspace = join(root, 'workspace');
  marker = join(root, 'build-marker.log');
  writeFileSync(marker, '');

  // Minimal real Nx workspace: one npm-script project, cacheable `build`.
  mkdirSync(join(workspace, 'app'), { recursive: true });
  mkdirSync(join(workspace, 'node_modules'), { recursive: true });
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ name: 'nxrc-e2e-fixture', private: true, workspaces: ['app'] }),
  );
  writeFileSync(
    join(workspace, 'nx.json'),
    JSON.stringify({
      targetDefaults: { build: { cache: true, outputs: ['{projectRoot}/dist'] } },
    }),
  );
  writeFileSync(
    join(workspace, 'app', 'package.json'),
    JSON.stringify({
      name: 'app',
      version: '0.0.0',
      scripts: { build: 'node build.js' },
    }),
  );
  writeFileSync(join(workspace, 'app', 'build.js'), BUILD_JS);
  if (nxBin !== null) {
    // 'junction' is the portable dir-link type (ignored on POSIX).
    symlinkSync(dirname(dirname(nxBin)), join(workspace, 'node_modules', 'nx'), 'junction');
  }

  events = [];
  const logger: LogFn = (event, ctx) => events.push({ event, ...ctx });
  server = createRemoteCacheServer({
    backend: new FileSystemBackend(storeDir),
    tokens: [{ token: 'tok', write: 'main', read: ['main'] }],
    logger,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr !== 'object') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dirname(storeDir), { recursive: true, force: true });
});

describe.skipIf(nxBin === null)('real Nx <-> server (NX_SELF_HOSTED_REMOTE_CACHE_SERVER)', () => {
  it('nx run uploads outputs, then a cold workspace restores them from the server', async () => {
    const first = await runNx(['run', 'app:build']);
    expect(first).toContain('app build ran');
    expect(readFileSync(join(workspace, 'app', 'dist', 'out.txt'), 'utf8')).toBe(
      'hello-from-build\n',
    );
    expect(markerRuns()).toBe(1);
    const stored = events.filter((e) => e.event === 'cache.stored');
    expect(stored).toHaveLength(1);
    const hash = stored[0]!.hash;
    expect(events.some((e) => e.event === 'cache.miss' && e.hash === hash)).toBe(true);

    // Cold local cache + deleted outputs — the only place left to serve
    // the artifact is this server.
    rmSync(join(workspace, '.nx'), { recursive: true, force: true });
    rmSync(join(workspace, 'app', 'dist'), { recursive: true, force: true });
    events.length = 0;

    const second = await runNx(['run', 'app:build']);
    expect(second).toContain('from the cache');
    expect(readFileSync(join(workspace, 'app', 'dist', 'out.txt'), 'utf8')).toBe(
      'hello-from-build\n',
    );
    // The build script did NOT re-run — outputs came off the wire.
    expect(markerRuns()).toBe(1);
    expect(events.some((e) => e.event === 'cache.hit' && e.hash === hash)).toBe(true);
    // No second PUT: a re-run would have tried to upload again.
    expect(existsSync(join(storeDir, 'main', `${hash}`))).toBe(true);
  }, 120_000);
});
