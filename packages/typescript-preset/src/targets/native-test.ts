export function inferNativeTestTargets(
  projectRoot: string,
  options: {
    tap: boolean;
    coverage: boolean;
    testGlob: string;
    specGlob: string;
  },
): {
  test: {
    executor: 'nx:run-commands';
    options: { command: string; cwd: string };
    cache: true;
    inputs: string[];
  };
  'test:tap'?: {
    executor: 'nx:run-commands';
    options: { command: string; cwd: string };
    outputs: string[];
    cache: true;
    inputs: string[];
  };
  'test:coverage'?: {
    executor: 'nx:run-commands';
    options: { command: string; cwd: string };
    cache: true;
    inputs: string[];
  };
} {
  const testFilePatterns = `{${options.testGlob},${options.specGlob}}`;
  // Tests exercise the whole project — `default` (all project files)
  // keeps the cache honest, while generated outputs are excluded so
  // running a target never invalidates its own hash (test:tap writes
  // test-results.tap, test:coverage writes coverage/, build writes dist/).
  const testInputs = [
    'default',
    '!{projectRoot}/dist',
    '!{projectRoot}/node_modules',
    '!{projectRoot}/coverage',
    '!{projectRoot}/test-results.tap',
    `{projectRoot}/${options.testGlob}`,
    `{projectRoot}/${options.specGlob}`,
    '{projectRoot}/package.json',
  ];

  const result: {
    test: {
      executor: 'nx:run-commands';
      options: { command: string; cwd: string };
      cache: true;
      inputs: string[];
    };
    'test:tap'?: {
      executor: 'nx:run-commands';
      options: { command: string; cwd: string };
      outputs: string[];
      cache: true;
      inputs: string[];
    };
    'test:coverage'?: {
      executor: 'nx:run-commands';
      options: { command: string; cwd: string };
      cache: true;
      inputs: string[];
    };
  } = {
    test: {
      executor: 'nx:run-commands',
      options: {
        command: `node --test --test-reporter spec "${testFilePatterns}"`,
        cwd: projectRoot,
      },
      cache: true,
      inputs: testInputs,
    },
  };

  if (options.tap) {
    result['test:tap'] = {
      executor: 'nx:run-commands',
      options: {
        command: `node --test --test-reporter tap "${testFilePatterns}" > test-results.tap`,
        cwd: projectRoot,
      },
      outputs: ['{projectRoot}/test-results.tap'],
      cache: true,
      inputs: testInputs,
    };
  }

  if (options.coverage) {
    result['test:coverage'] = {
      executor: 'nx:run-commands',
      options: {
        command: `node --test --experimental-test-coverage "${testFilePatterns}"`,
        cwd: projectRoot,
      },
      cache: true,
      inputs: testInputs,
    };
  }

  return result;
}
