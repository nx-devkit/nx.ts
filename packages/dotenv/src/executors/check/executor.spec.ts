import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ExecutorContext } from '@nx/devkit';
import { afterEach, describe, expect, it } from 'vitest';
import { checkExecutor } from './executor.ts';

function makeContext(root: string): ExecutorContext {
  return { root } as unknown as ExecutorContext;
}

const tempRoots: string[] = [];
const envBackup = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!envBackup.has(name)) envBackup.set(name, process.env[name]);
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
  for (const [name, value] of envBackup) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  envBackup.clear();
});

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-dotenv-exec-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('checkExecutor', () => {
  it('succeeds when every required key exists in the sibling .env', async () => {
    const root = makeWorkspace({
      'app/.env.example': 'FOO=\nBAR=\n',
      'app/.env': 'FOO=1\nBAR=2\n',
    });
    const result = await checkExecutor({ examples: ['app/.env.example'] }, makeContext(root));
    expect(result.success).toBe(true);
  });

  it('succeeds when a required key comes from process.env', async () => {
    setEnv('DOTENV_SPEC_VAR', 'set');
    const root = makeWorkspace({ 'app/.env.example': 'DOTENV_SPEC_VAR=\n' });
    const result = await checkExecutor({ examples: ['app/.env.example'] }, makeContext(root));
    expect(result.success).toBe(true);
  });

  it('fails loud and lists every missing var name', async () => {
    setEnv('DOTENV_MISSING_A', undefined);
    setEnv('DOTENV_MISSING_B', undefined);
    const root = makeWorkspace({
      'app/.env.example': 'DOTENV_MISSING_A=\nDOTENV_MISSING_B=\nPRESENT=\n',
      'app/.env': 'PRESENT=1\n',
    });
    const result = await checkExecutor({ examples: ['app/.env.example'] }, makeContext(root));
    expect(result.success).toBe(false);
    expect(result.missing).toEqual(['DOTENV_MISSING_A', 'DOTENV_MISSING_B']);
  });

  it('never echoes secret values in the report', async () => {
    setEnv('DOTENV_MISSING_SECRET', undefined);
    const root = makeWorkspace({
      'app/.env.example': 'DOTENV_MISSING_SECRET=hunter2\n',
      'app/.env': 'OTHER=hunter2\n',
    });
    const result = await checkExecutor({ examples: ['app/.env.example'] }, makeContext(root));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('fails loud when the example file itself is missing', async () => {
    const root = makeWorkspace({});
    const result = await checkExecutor({ examples: ['app/.env.example'] }, makeContext(root));
    expect(result.success).toBe(false);
    expect(result.missing).toBeUndefined();
  });

  it('treats a missing .env file as "only process.env counts"', async () => {
    setEnv('DOTENV_ONLY_ENV', 'set');
    setEnv('DOTENV_ABSENT', undefined);
    const root = makeWorkspace({
      'app/.env.example': 'DOTENV_ONLY_ENV=\nDOTENV_ABSENT=\n',
    });
    const result = await checkExecutor({ examples: ['app/.env.example'] }, makeContext(root));
    expect(result.success).toBe(false);
    expect(result.missing).toEqual(['DOTENV_ABSENT']);
  });

  it('honors an explicit envFile option', async () => {
    const root = makeWorkspace({
      'app/.env.example': 'FOO=\n',
      'config/local.env': 'FOO=1\n',
    });
    const result = await checkExecutor(
      { examples: ['app/.env.example'], envFile: 'config/local.env' },
      makeContext(root),
    );
    expect(result.success).toBe(true);
  });

  it('checks every example in the list and merges the report', async () => {
    setEnv('DOTENV_X_A', undefined);
    setEnv('DOTENV_X_B', undefined);
    const root = makeWorkspace({
      'app/.env.example': 'DOTENV_X_A=\n',
      'app/.env.sample': 'DOTENV_X_B=\n',
      'app/.env': '',
    });
    const result = await checkExecutor(
      { examples: ['app/.env.example', 'app/.env.sample'] },
      makeContext(root),
    );
    expect(result.success).toBe(false);
    expect(result.missing).toEqual(['DOTENV_X_A', 'DOTENV_X_B']);
  });

  it('does not let multiline quoted values leak fake keys', async () => {
    setEnv('CERT', 'pem');
    const root = makeWorkspace({
      '.env.example': 'CERT="-----BEGIN\nDOTENV_FAKE=x\n-----END"\n',
    });
    const result = await checkExecutor({ examples: ['.env.example'] }, makeContext(root));
    expect(result.success).toBe(true);
  });
});
