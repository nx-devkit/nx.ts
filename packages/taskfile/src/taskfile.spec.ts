import { describe, expect, it } from 'vitest';
import { parseTaskfile } from './taskfile.ts';

describe('parseTaskfile', () => {
  it('parses the tasks map with desc and internal', () => {
    const tf = parseTaskfile(
      `version: '3'
tasks:
  build:
    desc: Build the app
    deps: [lint]
    cmds:
      - go build ./...
  lint:
    cmds:
      - golangci-lint run
  hidden:
    internal: true
    cmds:
      - echo never
`,
      'Taskfile.yml',
    );

    expect(tf.tasks.build).toEqual({ desc: 'Build the app', internal: false });
    expect(tf.tasks.lint).toEqual({ desc: undefined, internal: false });
    expect(tf.tasks.hidden).toEqual({ desc: undefined, internal: true });
  });

  it('expands `<<` merge keys so inherited fields are visible', () => {
    const tf = parseTaskfile(
      `version: '3'
defaults: &defaults
  internal: true
  desc: inherited
tasks:
  helper:
    <<: *defaults
`,
      'Taskfile.yml',
    );

    expect(tf.tasks.helper).toEqual({ desc: 'inherited', internal: true });
  });

  it('normalizes string and map include forms', () => {
    const tf = parseTaskfile(
      `version: '3'
includes:
  lib: ./lib/Taskfile.yml
  docs:
    taskfile: ./docs
    dir: ./docs
    optional: true
    internal: false
    flatten: false
tasks: {}
`,
      'Taskfile.yml',
    );

    expect(tf.includes.lib).toEqual({
      taskfile: './lib/Taskfile.yml',
      dir: undefined,
      optional: false,
      internal: false,
      flatten: false,
    });
    expect(tf.includes.docs).toEqual({
      taskfile: './docs',
      dir: './docs',
      optional: true,
      internal: false,
      flatten: false,
    });
  });

  it('returns empty maps when tasks or includes are absent', () => {
    const tf = parseTaskfile(`version: '3'\n`, 'Taskfile.yml');

    expect(tf.tasks).toEqual({});
    expect(tf.includes).toEqual({});
  });

  it('skips task entries that are not mappings', () => {
    const tf = parseTaskfile(
      `version: '3'
tasks:
  good:
    cmds: [echo ok]
  bad: "just a string"
`,
      'Taskfile.yml',
    );

    expect(Object.keys(tf.tasks)).toEqual(['good']);
  });

  it('throws on malformed YAML', () => {
    expect(() => parseTaskfile('tasks: [unclosed', 'Taskfile.yml')).toThrow();
  });

  it('throws when the document is not a mapping', () => {
    expect(() => parseTaskfile('- just\n- a\n- list\n', 'Taskfile.yml')).toThrow(/not a mapping/);
  });

  it('does not let a __proto__ task key mutate the prototype', () => {
    const tf = parseTaskfile(
      `version: '3'
tasks:
  __proto__:
    cmds: [echo x]
`,
      'Taskfile.yml',
    );

    expect(Object.getPrototypeOf(tf.tasks)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(tf.tasks, '__proto__')).toBeDefined();
  });
});
