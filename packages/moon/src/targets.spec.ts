import { describe, expect, it } from 'vitest';
import { buildTaskTarget, parseDepTarget, type TaskTargetContext } from './targets.ts';

const CTX: TaskTargetContext = {
  targetPrefix: '',
  projectRoot: 'packages/app',
  configFile: 'packages/app/moon.yml',
  projectEnv: {},
  fileGroups: {},
  workspaceInputs: [],
  nameByMoonId: new Map(),
};

const ctx = (overrides: Partial<TaskTargetContext> = {}): TaskTargetContext => ({
  ...CTX,
  ...overrides,
});

describe('parseDepTarget', () => {
  it('parses a plain task as a self dependency', () => {
    expect(parseDepTarget('codegen')).toEqual({ kind: 'self', task: 'codegen' });
  });

  it('parses ~ scope forms as self', () => {
    expect(parseDepTarget('~:typecheck')).toEqual({ kind: 'self', task: 'typecheck' });
    expect(parseDepTarget('~typecheck')).toEqual({ kind: 'self', task: 'typecheck' });
  });

  it('parses ^ scope forms as dependency projects', () => {
    expect(parseDepTarget('^:build')).toEqual({ kind: 'deps', task: 'build' });
    expect(parseDepTarget('^build')).toEqual({ kind: 'deps', task: 'build' });
  });

  it('parses project:task', () => {
    expect(parseDepTarget('shared:prepare')).toEqual({
      kind: 'project',
      project: 'shared',
      task: 'prepare',
    });
  });

  it('parses unresolvable scopes', () => {
    expect(parseDepTarget('#frontend:lint').kind).toBe('unsupported');
    expect(parseDepTarget(':all').kind).toBe('unsupported');
    expect(parseDepTarget('').kind).toBe('unsupported');
  });
});

describe('buildTaskTarget', () => {
  it('runs the task command through nx:run-commands in the project dir', () => {
    const target = buildTaskTarget('build', { command: 'vite build' }, CTX);
    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toMatchObject({ command: 'vite build', cwd: '{projectRoot}' });
  });

  it('joins command arrays and appends args', () => {
    const target = buildTaskTarget(
      'build',
      { command: ['vite', 'build'], args: ['--mode', 'prod'] },
      CTX,
    );
    expect(target.options).toMatchObject({ command: 'vite build --mode prod' });
  });

  it('appends string args', () => {
    const target = buildTaskTarget('build', { command: 'tsc', args: '-b' }, CTX);
    expect(target.options).toMatchObject({ command: 'tsc -b' });
  });

  it('lets script supersede command and args', () => {
    const target = buildTaskTarget(
      'seed',
      { script: 'ps aux | grep 3000', command: 'ignored', args: '--also-ignored' },
      CTX,
    );
    expect(target.options).toMatchObject({ command: 'ps aux | grep 3000' });
  });

  it('uses nx:noop for a task without command or script', () => {
    const target = buildTaskTarget('all', { deps: ['build'] }, CTX);
    expect(target.executor).toBe('nx:noop');
    expect(target.dependsOn).toEqual([{ target: 'build' }]);
  });

  it('is cached by default', () => {
    expect(buildTaskTarget('build', { command: 'x' }, CTX).cache).toBe(true);
  });

  it('honours options.cache forms', () => {
    expect(buildTaskTarget('t', { options: { cache: false } }, CTX).cache).toBe(false);
    expect(buildTaskTarget('t', { options: { cache: 'local' } }, CTX).cache).toBe(true);
    expect(buildTaskTarget('t', { options: { cache: 'remote' } }, CTX).cache).toBe(true);
  });

  it('treats deprecated local: true as uncached', () => {
    expect(buildTaskTarget('t', { local: true }, CTX).cache).toBe(false);
  });

  it('maps options.persistent to a continuous, uncached target', () => {
    // 'watch' carries no implicit server preset — 'dev' would make this
    // pass even if options.persistent were ignored.
    const target = buildTaskTarget('watch', { options: { persistent: true } }, CTX);
    expect(target.continuous).toBe(true);
    expect(target.cache).toBe(false);
  });

  it('applies the server preset as continuous and uncached', () => {
    const target = buildTaskTarget('api', { preset: 'server' }, CTX);
    expect(target.continuous).toBe(true);
    expect(target.cache).toBe(false);
  });

  it('applies the utility preset as uncached only', () => {
    const target = buildTaskTarget('clean', { preset: 'utility' }, CTX);
    expect(target.cache).toBe(false);
    expect(target.continuous).toBeUndefined();
  });

  it('marks dev/start/serve tasks as servers like moon does', () => {
    for (const name of ['dev', 'start', 'serve']) {
      const target = buildTaskTarget(name, { command: 'x' }, CTX);
      expect(target.continuous).toBe(true);
      expect(target.cache).toBe(false);
    }
    expect(buildTaskTarget('dev-server', { command: 'x' }, CTX).continuous).toBeUndefined();
  });

  it('lets explicit options beat the name-based server persistent default', () => {
    const target = buildTaskTarget('dev', { options: { persistent: false } }, CTX);
    expect(target.continuous).toBeUndefined();
    // ...but the server preset still turns the cache off
    expect(target.cache).toBe(false);
  });

  it('defaults inputs to all project files plus the moon.yml input', () => {
    const target = buildTaskTarget('build', {}, CTX);
    expect(target.inputs).toEqual(['{projectRoot}/**/*', '{workspaceRoot}/packages/app/moon.yml']);
  });

  it('maps project and workspace relative input patterns', () => {
    const target = buildTaskTarget(
      'build',
      { inputs: ['src/**/*', '/tsconfig.base.json', '!src/gen/**'] },
      CTX,
    );
    expect(target.inputs).toEqual([
      '{projectRoot}/src/**/*',
      '{workspaceRoot}/tsconfig.base.json',
      '!{projectRoot}/src/gen/**',
      '{workspaceRoot}/packages/app/moon.yml',
    ]);
  });

  it('maps $ENV inputs to env hash inputs and drops env wildcards', () => {
    const target = buildTaskTarget('t', { inputs: ['$FOO_CACHE', '$FOO_*'] }, CTX);
    expect(target.inputs).toContainEqual({ env: 'FOO_CACHE' });
    expect(target.inputs).not.toContainEqual({ env: 'FOO_*' });
  });

  it('maps token variables', () => {
    const target = buildTaskTarget(
      't',
      {
        inputs: ['$projectRoot', '$workspaceRoot'],
        command: 'cd $workspaceRoot && ls $projectRoot',
      },
      CTX,
    );
    expect(target.inputs).toContain('{projectRoot}');
    expect(target.inputs).toContain('{workspaceRoot}');
    // The same token variables are substituted inside commands.
    expect(target.options).toMatchObject({ command: 'cd ../.. && ls .' });
  });

  it('resolves @group tokens against local fileGroups', () => {
    const target = buildTaskTarget(
      'build',
      { inputs: ['@group(sources)'] },
      ctx({ fileGroups: { sources: ['src/**/*', 'types/**/*'] } }),
    );
    expect(target.inputs).toEqual([
      '{projectRoot}/src/**/*',
      '{projectRoot}/types/**/*',
      '{workspaceRoot}/packages/app/moon.yml',
    ]);
  });

  it('expands group entries recursively including workspace paths', () => {
    const target = buildTaskTarget(
      'build',
      { inputs: ['@group(sources)'] },
      ctx({
        fileGroups: { sources: ['/tsconfig.base.json', '$CI', '@group(src)'], src: ['src/**'] },
      }),
    );
    expect(target.inputs).toContain('{workspaceRoot}/tsconfig.base.json');
    expect(target.inputs).toContainEqual({ env: 'CI' });
    expect(target.inputs).toContain('{projectRoot}/src/**');
  });

  it('ignores inherited object keys like @group(constructor)', () => {
    const target = buildTaskTarget('t', { inputs: ['@group(constructor)', 'src/**'] }, CTX);
    expect(target.inputs).toEqual([
      '{projectRoot}/src/**',
      '{workspaceRoot}/packages/app/moon.yml',
    ]);
  });

  it('only passes the Nx {projectRoot}/{workspaceRoot} tokens through', () => {
    const target = buildTaskTarget(
      't',
      { inputs: ['{projectRoot}/src/**', '{src,lib}/**/*.ts'] },
      CTX,
    );
    expect(target.inputs).toEqual([
      '{projectRoot}/src/**',
      '{projectRoot}/{src,lib}/**/*.ts',
      '{workspaceRoot}/packages/app/moon.yml',
    ]);
  });

  it('toggles leading ! when negating a group instead of double-negating', () => {
    const target = buildTaskTarget(
      't',
      { inputs: ['!@group(files)'] },
      ctx({ fileGroups: { files: ['src/**', '!src/gen/**'] } }),
    );
    expect(target.inputs).toEqual([
      '!{projectRoot}/src/**',
      '{projectRoot}/src/gen/**',
      '{workspaceRoot}/packages/app/moon.yml',
    ]);
  });

  it('skips unresolved @tokens and group:// of unknown groups', () => {
    const target = buildTaskTarget(
      't',
      { inputs: ['@group(missing)', 'group://missing', 'src/**'] },
      CTX,
    );
    expect(target.inputs).toEqual([
      '{projectRoot}/src/**',
      '{workspaceRoot}/packages/app/moon.yml',
    ]);
  });

  it('maps file:// and glob:// URI inputs', () => {
    const target = buildTaskTarget(
      't',
      {
        inputs: [
          'file://project/rel.js?optional',
          'file:///workspace/rel.js',
          'glob://src/**/*.ts?cache=false',
          'glob:///workspace/**/*',
          'glob://!/src/gen/**',
        ],
      },
      CTX,
    );
    expect(target.inputs).toEqual([
      '{projectRoot}/project/rel.js',
      '{workspaceRoot}/workspace/rel.js',
      '{projectRoot}/src/**/*.ts',
      '{workspaceRoot}/workspace/**/*',
      '!{workspaceRoot}/src/gen/**',
      '{workspaceRoot}/packages/app/moon.yml',
    ]);
  });

  it('maps object-form inputs', () => {
    const target = buildTaskTarget(
      't',
      {
        inputs: [
          { file: 'a.js', optional: true },
          { glob: '/b/**/*' },
          { group: 'sources' },
          { project: 'other' },
        ],
      },
      ctx({ fileGroups: { sources: ['src/**'] } }),
    );
    expect(target.inputs).toEqual([
      '{projectRoot}/a.js',
      '{workspaceRoot}/b/**/*',
      '{projectRoot}/src/**',
      '{workspaceRoot}/packages/app/moon.yml',
    ]);
  });

  it('skips project:// external project inputs', () => {
    const target = buildTaskTarget('t', { inputs: ['project://foo', 'src/**'] }, CTX);
    expect(target.inputs).toEqual([
      '{projectRoot}/src/**',
      '{workspaceRoot}/packages/app/moon.yml',
    ]);
  });

  it('maps outputs like inputs but keeps negations and no env entries', () => {
    const target = buildTaskTarget(
      'build',
      { outputs: ['dist', '!dist/internal/**', '/shared-assets/**', { glob: 'lib/**/*.js' }] },
      CTX,
    );
    expect(target.outputs).toEqual([
      '{projectRoot}/dist',
      '!{projectRoot}/dist/internal/**',
      '{workspaceRoot}/shared-assets/**',
      '{projectRoot}/lib/**/*.js',
    ]);
  });

  it('emits no file outputs when outputs is absent', () => {
    expect(buildTaskTarget('build', {}, CTX).outputs).toEqual([]);
  });

  it('maps envFile to a workspace-relative run-commands envFile path and inputs', () => {
    const target = buildTaskTarget(
      'build',
      { command: 'x', options: { envFile: '.env.production' } },
      CTX,
    );
    expect(target.options).toMatchObject({ envFile: 'packages/app/.env.production' });
    expect(target.inputs).toContain('{projectRoot}/.env.production');
  });

  it('maps a workspace-root envFile', () => {
    const target = buildTaskTarget(
      'build',
      { command: 'x', options: { envFile: '/.env.shared' } },
      CTX,
    );
    expect(target.options).toMatchObject({ envFile: '.env.shared' });
    expect(target.inputs).toContain('{workspaceRoot}/.env.shared');
  });

  it('expands envFile: true into the moon .env chain as inputs only', () => {
    const target = buildTaskTarget('build', { command: 'x', options: { envFile: true } }, CTX);
    // nx:run-commands fails on a missing envFile while moon tolerates it —
    // the `true` chain only becomes hash inputs, never the option.
    expect(target.options).not.toHaveProperty('envFile');
    for (const file of [
      '{workspaceRoot}/.env',
      '{workspaceRoot}/.env.local',
      '{projectRoot}/.env',
      '{projectRoot}/.env.local',
      '{projectRoot}/.env.build',
      '{projectRoot}/.env.build.local',
    ]) {
      expect(target.inputs).toContain(file);
    }
  });

  it('maps an envFile list to the first file plus all inputs', () => {
    const target = buildTaskTarget(
      'build',
      { command: 'x', options: { envFile: ['.env', '/.env.shared'] } },
      CTX,
    );
    expect(target.options).toMatchObject({ envFile: 'packages/app/.env' });
    expect(target.inputs).toContain('{projectRoot}/.env');
    expect(target.inputs).toContain('{workspaceRoot}/.env.shared');
  });

  it('folds project env then task env into run-commands env', () => {
    const target = buildTaskTarget(
      'build',
      { command: 'x', env: { NODE_ENV: 'production' } },
      ctx({ projectEnv: { LOG_LEVEL: 'info', NODE_ENV: 'development' } }),
    );
    expect(target.options).toMatchObject({
      env: { LOG_LEVEL: 'info', NODE_ENV: 'production' },
    });
  });

  it('appends workspace files to every target inputs', () => {
    const target = buildTaskTarget(
      'build',
      {},
      ctx({ workspaceInputs: ['{workspaceRoot}/.moon/workspace.yml'] }),
    );
    expect(target.inputs).toContain('{workspaceRoot}/.moon/workspace.yml');
  });

  it('maps ^:task and ^task to dependency projects', () => {
    const target = buildTaskTarget('build', { deps: ['^:build', '^prepare'] }, CTX);
    expect(target.dependsOn).toEqual([
      { target: 'build', dependencies: true },
      { target: 'prepare', dependencies: true },
    ]);
  });

  it('maps task and ~:task to the same project', () => {
    const target = buildTaskTarget('test', { deps: ['build', '~:codegen'] }, CTX);
    expect(target.dependsOn).toEqual([{ target: 'build' }, { target: 'codegen' }]);
  });

  it('maps proj:task to the named project', () => {
    const target = buildTaskTarget('deploy', { deps: ['shared:assets'] }, CTX);
    expect(target.dependsOn).toEqual([{ target: 'assets', projects: ['shared'] }]);
  });

  it('maps proj:task moon ids to resolved Nx project names', () => {
    const target = buildTaskTarget(
      'deploy',
      { deps: ['shared:assets', 'other:prep'] },
      ctx({ nameByMoonId: new Map([['shared', '@acme/shared']]) }),
    );
    expect(target.dependsOn).toEqual([
      { target: 'assets', projects: ['@acme/shared'] },
      // Unmatched ids pass through — another plugin may own the name.
      { target: 'prep', projects: ['other'] },
    ]);
  });

  it('maps object deps by target only', () => {
    const target = buildTaskTarget(
      'deploy',
      { deps: [{ target: 'shared:assets', optional: true, env: { X: '1' } }] },
      CTX,
    );
    expect(target.dependsOn).toEqual([{ target: 'assets', projects: ['shared'] }]);
  });

  it('skips unsupported dep scopes', () => {
    const target = buildTaskTarget('t', { deps: ['#frontend:lint', ':all', 'codegen'] }, CTX);
    expect(target.dependsOn).toEqual([{ target: 'codegen' }]);
  });

  it('applies the targetPrefix to the target and its deps', () => {
    const prefixed = ctx({ targetPrefix: 'moon:' });
    const target = buildTaskTarget(
      'build',
      { deps: ['^:build', 'codegen', 'shared:prep'] },
      prefixed,
    );
    expect(target.dependsOn).toEqual([
      { target: 'moon:build', dependencies: true },
      { target: 'moon:codegen' },
      { target: 'moon:prep', projects: ['shared'] },
    ]);
  });

  it('dedupes inputs', () => {
    const target = buildTaskTarget('t', { inputs: ['src/**', 'src/**'] }, CTX);
    expect(target.inputs!.filter((i) => i === '{projectRoot}/src/**')).toHaveLength(1);
  });

  it('carries the task description into metadata', () => {
    const target = buildTaskTarget('build', { description: 'Builds it' }, CTX);
    expect(target.metadata).toEqual({ description: 'Builds it' });
  });
});
