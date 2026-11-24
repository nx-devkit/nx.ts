import { describe, expect, it } from 'vitest';
import type { TaskfileTask } from './taskfile.ts';
import { buildTaskTarget, isSafeTaskName, targetNameFor } from './targets.ts';

const task = (over: Partial<TaskfileTask> = {}): TaskfileTask => ({
  desc: undefined,
  internal: false,
  deps: [],
  ...over,
});

const ctx = (over: Partial<Parameters<typeof buildTaskTarget>[2]> = {}) => ({
  targetPrefix: 'task',
  depPrefix: '',
  cache: false,
  inputs: ['{workspaceRoot}/Taskfile.yml'],
  resolvable: new Set<string>(),
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
});

describe('buildTaskTarget', () => {
  it('runs `task <name>` via nx:run-commands from the project root', () => {
    const target = buildTaskTarget('build', task(), ctx());

    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({ command: 'task build', cwd: '{projectRoot}' });
  });

  it('runs namespaced tasks through their task CLI name', () => {
    const target = buildTaskTarget('lib:gen', task(), ctx({ depPrefix: 'lib:' }));

    expect(target.options).toEqual({ command: 'task lib:gen', cwd: '{projectRoot}' });
  });

  it('is not cacheable by default', () => {
    expect(buildTaskTarget('build', task(), ctx()).cache).toBe(false);
  });

  it('honours the cache option', () => {
    expect(buildTaskTarget('build', task(), ctx({ cache: true })).cache).toBe(true);
  });

  it('carries the declaring taskfiles as inputs', () => {
    const inputs = ['{workspaceRoot}/Taskfile.yml', '{workspaceRoot}/lib/Taskfile.yml'];
    const target = buildTaskTarget('build', task(), ctx({ inputs }));

    expect(target.inputs).toEqual(inputs);
  });

  it('maps desc to metadata.description', () => {
    const target = buildTaskTarget('build', task({ desc: 'Build the app' }), ctx());

    expect(target.metadata?.description).toBe('Build the app');
  });

  it('omits metadata when there is no desc', () => {
    expect(buildTaskTarget('build', task(), ctx()).metadata).toBeUndefined();
  });

  it('maps deps to dependsOn targets on the same project', () => {
    const target = buildTaskTarget(
      'release',
      task({ deps: ['build', 'lint'] }),
      ctx({ resolvable: new Set(['build', 'lint']) }),
    );

    expect(target.dependsOn).toEqual([{ target: 'task:build' }, { target: 'task:lint' }]);
  });

  it('prefixes deps declared inside an included taskfile with its namespace', () => {
    // `ns:release` deps on `build` — inside the included file that dep
    // resolves as `ns:build`.
    const target = buildTaskTarget(
      'ns:release',
      task({ deps: ['build'] }),
      ctx({ depPrefix: 'ns:', resolvable: new Set(['ns:build']) }),
    );

    expect(target.dependsOn).toEqual([{ target: 'task:ns:build' }]);
  });

  it('drops deps that resolve to no emitted target', () => {
    const target = buildTaskTarget(
      'release',
      task({ deps: ['build', 'internal-helper', 'missing'] }),
      ctx({ resolvable: new Set(['build']) }),
    );

    expect(target.dependsOn).toEqual([{ target: 'task:build' }]);
  });

  it('omits dependsOn when nothing resolves', () => {
    const target = buildTaskTarget('a', task({ deps: ['missing'] }), ctx());

    expect(target.dependsOn).toBeUndefined();
  });

  it('honours a custom targetPrefix', () => {
    const target = buildTaskTarget(
      'release',
      task({ deps: ['build'] }),
      ctx({ targetPrefix: 'tf', resolvable: new Set(['build']) }),
    );

    expect(target.dependsOn).toEqual([{ target: 'tf:build' }]);
  });
});
