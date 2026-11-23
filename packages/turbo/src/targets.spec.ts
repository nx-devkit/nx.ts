import { describe, expect, it } from 'vitest';
import { buildTaskTarget, splitTaskKey } from './targets.ts';

const CTX = {
  rootProjectName: 'root-app',
  configFile: 'turbo.json',
  globalInputs: [] as (string | { env: string })[],
};

describe('splitTaskKey', () => {
  it('splits a plain task name', () => {
    expect(splitTaskKey('build')).toEqual({ package: null, task: 'build' });
  });

  it('splits a package#task key', () => {
    expect(splitTaskKey('docs#lint')).toEqual({
      package: 'docs',
      task: 'lint',
    });
  });

  it('splits a scoped package#task key', () => {
    expect(splitTaskKey('@acme/docs#lint')).toEqual({
      package: '@acme/docs',
      task: 'lint',
    });
  });

  it('splits a root //#task key', () => {
    expect(splitTaskKey('//#format')).toEqual({
      package: '//',
      task: 'format',
    });
  });
});

describe('buildTaskTarget', () => {
  it('runs the package script through nx:run-script', () => {
    const target = buildTaskTarget('build', {}, CTX);
    expect(target.executor).toBe('nx:run-script');
    expect(target.options).toEqual({ script: 'build' });
  });

  it('is cached by default', () => {
    expect(buildTaskTarget('build', {}, CTX).cache).toBe(true);
  });

  it('honours cache: false', () => {
    expect(buildTaskTarget('test', { cache: false }, CTX).cache).toBe(false);
  });

  it('maps persistent: true to a continuous, uncached target', () => {
    const target = buildTaskTarget('dev', { persistent: true }, CTX);
    expect(target.continuous).toBe(true);
    expect(target.cache).toBe(false);
  });

  it('emits no file outputs when `outputs` is absent', () => {
    expect(buildTaskTarget('build', {}, CTX).outputs).toEqual([]);
  });

  it('prefixes declared outputs with {projectRoot} and keeps negations', () => {
    const target = buildTaskTarget('build', { outputs: ['.next/**', '!.next/cache/**'] }, CTX);
    expect(target.outputs).toEqual(['{projectRoot}/.next/**', '!{projectRoot}/.next/cache/**']);
  });

  it('defaults inputs to default plus the turbo.json input', () => {
    const target = buildTaskTarget('build', {}, CTX);
    expect(target.inputs).toEqual(['default', '{workspaceRoot}/turbo.json']);
  });

  it('maps explicit inputs, $TURBO_DEFAULT$ and negations', () => {
    const target = buildTaskTarget(
      'build',
      { inputs: ['src/**', '$TURBO_DEFAULT$', '!src/gen/**'] },
      CTX,
    );
    expect(target.inputs).toEqual([
      '{projectRoot}/src/**',
      'default',
      '!{projectRoot}/src/gen/**',
      '{workspaceRoot}/turbo.json',
    ]);
  });

  it('uses a nested turbo.json path as the config input', () => {
    const target = buildTaskTarget('dev', {}, { ...CTX, configFile: 'packages/app/turbo.json' });
    expect(target.inputs).toContain('{workspaceRoot}/packages/app/turbo.json');
  });

  it('maps env and passThroughEnv to env hash inputs', () => {
    const target = buildTaskTarget(
      'deploy',
      { env: ['DEPLOY_TOKEN'], passThroughEnv: ['CI'] },
      CTX,
    );
    expect(target.inputs).toContainEqual({ env: 'DEPLOY_TOKEN' });
    expect(target.inputs).toContainEqual({ env: 'CI' });
  });

  it('maps dotEnv files to project inputs', () => {
    const target = buildTaskTarget('dev', { dotEnv: ['.env.local'] }, CTX);
    expect(target.inputs).toContain('{projectRoot}/.env.local');
  });

  it('appends global inputs', () => {
    const ctx = {
      ...CTX,
      globalInputs: ['{workspaceRoot}/tsconfig.base.json', { env: 'GLOBAL' }],
    };
    const target = buildTaskTarget('build', {}, ctx);
    expect(target.inputs).toContain('{workspaceRoot}/tsconfig.base.json');
    expect(target.inputs).toContainEqual({ env: 'GLOBAL' });
  });

  it('dedupes inputs', () => {
    const target = buildTaskTarget('build', { inputs: ['src/**', 'src/**'] }, CTX);
    expect(target.inputs!.filter((i) => i === '{projectRoot}/src/**')).toHaveLength(1);
  });

  it('maps ^task to dependency projects', () => {
    const target = buildTaskTarget('build', { dependsOn: ['^build'] }, CTX);
    expect(target.dependsOn).toEqual([{ target: 'build', dependencies: true }]);
  });

  it('maps a plain task to the same project', () => {
    const target = buildTaskTarget('test', { dependsOn: ['build'] }, CTX);
    expect(target.dependsOn).toEqual([{ target: 'build' }]);
  });

  it('maps pkg#task to the named project', () => {
    const target = buildTaskTarget('deploy', { dependsOn: ['ui#build'] }, CTX);
    expect(target.dependsOn).toEqual([{ target: 'build', projects: ['ui'] }]);
  });

  it('maps //#task to the root project name', () => {
    const target = buildTaskTarget('deploy', { dependsOn: ['//#gen'] }, CTX);
    expect(target.dependsOn).toEqual([{ target: 'gen', projects: ['root-app'] }]);
  });

  it('drops a //# dep when the root project has no name', () => {
    const target = buildTaskTarget(
      'deploy',
      { dependsOn: ['//#gen'] },
      { ...CTX, rootProjectName: undefined },
    );
    expect(target.dependsOn).toBeUndefined();
  });

  it('preserves dependsOn order and mixed forms', () => {
    const target = buildTaskTarget(
      'deploy',
      { dependsOn: ['^build', 'gen', 'ui#assets', '//#seed'] },
      CTX,
    );
    expect(target.dependsOn).toEqual([
      { target: 'build', dependencies: true },
      { target: 'gen' },
      { target: 'assets', projects: ['ui'] },
      { target: 'seed', projects: ['root-app'] },
    ]);
  });
});
