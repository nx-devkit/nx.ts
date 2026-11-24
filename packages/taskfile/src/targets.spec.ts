import { describe, expect, it } from 'vitest';
import type { TaskfileTask } from './taskfile.ts';
import { buildTaskTarget, isSafeTaskName, targetNameFor } from './targets.ts';

const task = (over: Partial<TaskfileTask> = {}): TaskfileTask => ({
  desc: undefined,
  internal: false,
  ...over,
});

const ctx = (over: Partial<Parameters<typeof buildTaskTarget>[2]> = {}) => ({
  targetPrefix: 'task',
  cache: false,
  inputs: ['{workspaceRoot}/Taskfile.yml'],
  ...over,
});

describe('targetNameFor', () => {
  it('prefixes the qualified task name', () => {
    expect(targetNameFor('build', 'task')).toBe('task:build');
    expect(targetNameFor('lib:gen', 'task')).toBe('task:lib:gen');
  });

  it('emits the bare name when the prefix is empty', () => {
    expect(targetNameFor('build', '')).toBe('build');
  });
});

describe('isSafeTaskName', () => {
  it('accepts plain and namespaced names', () => {
    expect(isSafeTaskName('build')).toBe(true);
    expect(isSafeTaskName('gen:proto')).toBe(true);
    expect(isSafeTaskName('build-app_v2.1')).toBe(true);
  });

  it('rejects names that would break shell quoting', () => {
    expect(isSafeTaskName('a;rm -rf /')).toBe(false);
    expect(isSafeTaskName('$(whoami)')).toBe(false);
    expect(isSafeTaskName('with space')).toBe(false);
    expect(isSafeTaskName('`id`')).toBe(false);
    expect(isSafeTaskName('"quoted"')).toBe(false);
    expect(isSafeTaskName('')).toBe(false);
  });

  it('rejects a leading dash — it would land on the CLI as a flag', () => {
    expect(isSafeTaskName('--init')).toBe(false);
    expect(isSafeTaskName('-w')).toBe(false);
    expect(isSafeTaskName('-')).toBe(false);
    expect(isSafeTaskName('a-b')).toBe(true);
    expect(isSafeTaskName('lib:x-y')).toBe(true);
  });
});

describe('buildTaskTarget', () => {
  it('runs `task <name>` via nx:run-commands from the project root', () => {
    const target = buildTaskTarget('build', task(), ctx());

    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({ command: 'task build', cwd: '{projectRoot}' });
  });

  it('runs namespaced tasks through their task CLI name', () => {
    const target = buildTaskTarget('lib:gen', task(), ctx());

    expect(target.options).toEqual({ command: 'task lib:gen', cwd: '{projectRoot}' });
  });

  it('is not cacheable by default', () => {
    expect(buildTaskTarget('build', task(), ctx()).cache).toBe(false);
  });

  it('honours the cache option', () => {
    expect(buildTaskTarget('build', task(), ctx({ cache: true })).cache).toBe(true);
  });

  it("keeps the project's normal inputs plus the declaring taskfiles", () => {
    const inputs = ['{workspaceRoot}/Taskfile.yml', '{workspaceRoot}/lib/Taskfile.yml'];
    const target = buildTaskTarget('build', task(), ctx({ inputs }));

    // 'default' so source edits bust an opt-in cache; the Taskfile
    // paths cover includes outside the project root.
    expect(target.inputs).toEqual(['default', ...inputs]);
  });

  it('maps desc to metadata.description', () => {
    const target = buildTaskTarget('build', task({ desc: 'Build the app' }), ctx());

    expect(target.metadata?.description).toBe('Build the app');
  });

  it('omits metadata when there is no desc', () => {
    expect(buildTaskTarget('build', task(), ctx()).metadata).toBeUndefined();
  });

  it("never emits dependsOn — `task <name>` runs the task's deps itself", () => {
    // An Nx edge would execute every Taskfile dep a second time.
    const target = buildTaskTarget('release', task(), ctx());

    expect(target.dependsOn).toBeUndefined();
  });

  it('honours a custom targetPrefix', () => {
    const target = buildTaskTarget('release', task(), ctx({ targetPrefix: 'tf' }));

    expect(target.options).toEqual({ command: 'task release', cwd: '{projectRoot}' });
  });
});
