import { describe, expect, it } from 'vitest';
import { parseMoonYml } from './moon-config.ts';

describe('parseMoonYml', () => {
  it('parses a tasks map', () => {
    const config = parseMoonYml(
      [
        'tasks:',
        '  build:',
        "    command: 'vite build'",
        '  lint:',
        "    command: 'eslint .'",
        '',
      ].join('\n'),
      'moon.yml',
    );
    expect(Object.keys(config.tasks).sort()).toEqual(['build', 'lint']);
    expect(config.tasks.build?.command).toBe('vite build');
  });

  it('accepts a string task as command shorthand', () => {
    const config = parseMoonYml("tasks:\n  format: 'prettier --check .'\n", 'moon.yml');
    expect(config.tasks.format?.command).toBe('prettier --check .');
  });

  it('throws when tasks is present but not a map', () => {
    expect(() => parseMoonYml('tasks: []\n', 'moon.yml')).toThrow(/tasks/);
    expect(() => parseMoonYml("tasks: 'build'\n", 'moon.yml')).toThrow(/tasks/);
    // An empty `tasks:` key is just absent, not malformed.
    expect(parseMoonYml('tasks:\n', 'moon.yml').tasks).toEqual({});
  });

  it('reads project metadata fields', () => {
    const config = parseMoonYml(
      [
        "id: 'app'",
        "language: 'typescript'",
        "type: 'application'",
        'tags:',
        "  - 'frontend'",
        'dependsOn:',
        "  - 'designSystem'",
        "  - id: 'apiClients'",
        "    scope: 'peer'",
        '',
      ].join('\n'),
      'moon.yml',
    );
    expect(config.id).toBe('app');
    expect(config.language).toBe('typescript');
    expect(config.type).toBe('application');
    expect(config.tags).toEqual(['frontend']);
    expect(config.dependsOn).toEqual(['designSystem', { id: 'apiClients', scope: 'peer' }]);
  });

  it('reads the project block as metadata', () => {
    const config = parseMoonYml(
      ['project:', "  title: 'My App'", "  description: 'The app.'", ''].join('\n'),
      'moon.yml',
    );
    expect(config.project).toEqual({ title: 'My App', description: 'The app.' });
  });

  it('accepts a string project field as a name', () => {
    const config = parseMoonYml("project: 'custom-name'\n", 'moon.yml');
    expect(config.project).toBe('custom-name');
  });

  it('reads task deps in string and object forms', () => {
    const config = parseMoonYml(
      [
        'tasks:',
        '  build:',
        "    command: 'webpack'",
        '    deps:',
        "      - '^:compile'",
        "      - 'codegen'",
        "      - 'shared:prepare'",
        "      - target: 'docs:assets'",
        '        optional: true',
        '',
      ].join('\n'),
      'moon.yml',
    );
    expect(config.tasks.build?.deps).toEqual([
      '^:compile',
      'codegen',
      'shared:prepare',
      { target: 'docs:assets', optional: true },
    ]);
  });

  it('reads env, inputs, outputs and options', () => {
    const config = parseMoonYml(
      [
        'tasks:',
        '  build:',
        "    command: 'webpack'",
        '    env:',
        "      NODE_ENV: 'production'",
        '    inputs:',
        "      - 'src/**/*'",
        "      - '/tsconfig.base.json'",
        '    outputs:',
        "      - 'dist'",
        '    options:',
        '      cache: false',
        '      persistent: true',
        "      envFile: '.env.production'",
        '',
      ].join('\n'),
      'moon.yml',
    );
    const task = config.tasks.build;
    expect(task?.env).toEqual({ NODE_ENV: 'production' });
    expect(task?.inputs).toEqual(['src/**/*', '/tsconfig.base.json']);
    expect(task?.outputs).toEqual(['dist']);
    expect(task?.options).toEqual({
      cache: false,
      persistent: true,
      envFile: '.env.production',
    });
  });

  it('reads project-level env and fileGroups', () => {
    const config = parseMoonYml(
      [
        'env:',
        "  NODE_ENV: 'development'",
        'fileGroups:',
        '  sources:',
        "    - 'src/**/*'",
        'tasks:',
        '  build:',
        "    command: 'tsc'",
        '',
      ].join('\n'),
      'moon.yml',
    );
    expect(config.env).toEqual({ NODE_ENV: 'development' });
    expect(config.fileGroups).toEqual({ sources: ['src/**/*'] });
  });

  it('keeps command arrays and args forms verbatim', () => {
    const config = parseMoonYml(
      [
        'tasks:',
        '  build:',
        '    command:',
        "      - 'vite'",
        "      - 'build'",
        '    args:',
        "      - '--mode'",
        "      - 'production'",
        '',
      ].join('\n'),
      'moon.yml',
    );
    expect(config.tasks.build?.command).toEqual(['vite', 'build']);
    expect(config.tasks.build?.args).toEqual(['--mode', 'production']);
  });

  it('reads script which supersedes command', () => {
    const config = parseMoonYml(
      ['tasks:', '  seed:', "    script: 'ps aux | grep 3000'", "    command: 'ignored'", ''].join(
        '\n',
      ),
      'moon.yml',
    );
    expect(config.tasks.seed?.script).toBe('ps aux | grep 3000');
    expect(config.tasks.seed?.command).toBe('ignored');
  });

  it('returns an empty tasks map when tasks is absent', () => {
    const config = parseMoonYml("language: 'go'\n", 'moon.yml');
    expect(config.tasks).toEqual({});
  });

  it('throws when the document is not a map', () => {
    expect(() => parseMoonYml('- a\n- b\n', 'moon.yml')).toThrow();
    expect(() => parseMoonYml('42\n', 'moon.yml')).toThrow();
  });

  it('throws on invalid YAML', () => {
    expect(() => parseMoonYml('tasks:\n  build: [unclosed\n', 'moon.yml')).toThrow();
  });

  it('drops non-map task entries', () => {
    const config = parseMoonYml('tasks:\n  broken: 42\n  ok:\n    command: tsc\n', 'moon.yml');
    expect(config.tasks.broken).toBeUndefined();
    expect(config.tasks.ok?.command).toBe('tsc');
  });
});
