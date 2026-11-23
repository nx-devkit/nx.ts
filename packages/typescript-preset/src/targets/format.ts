const BIOME_INPUTS = [
  '{projectRoot}/src/**/*',
  '{projectRoot}/biome.json',
  '{projectRoot}/biome.jsonc',
  '{projectRoot}/package.json',
];

const OXFMT_INPUTS = [
  '{projectRoot}/src/**/*',
  '{projectRoot}/.oxfmtrc.json',
  '{projectRoot}/.oxfmtrc.jsonc',
  '{projectRoot}/oxfmt.config.ts',
  '{projectRoot}/oxfmt.config.mts',
  '{projectRoot}/package.json',
];

export function inferBiomeTargets(
  projectRoot: string,
  includeLint: boolean,
): Record<
  string,
  {
    executor: 'nx:run-commands';
    options: { command: string; cwd: string };
    cache: boolean;
    inputs: string[];
  }
> {
  const targets: Record<
    string,
    {
      executor: 'nx:run-commands';
      options: { command: string; cwd: string };
      cache: boolean;
      inputs: string[];
    }
  > = {
    format: {
      executor: 'nx:run-commands',
      options: {
        command: 'biome format --write .',
        cwd: projectRoot,
      },
      cache: false,
      inputs: BIOME_INPUTS,
    },
    'format-check': {
      executor: 'nx:run-commands',
      options: {
        command: 'biome format .',
        cwd: projectRoot,
      },
      cache: true,
      inputs: BIOME_INPUTS,
    },
  };

  if (includeLint) {
    targets.lint = {
      executor: 'nx:run-commands',
      options: {
        command: 'biome lint .',
        cwd: projectRoot,
      },
      cache: true,
      inputs: BIOME_INPUTS,
    };
  }

  return targets;
}

export function inferOxfmtTargets(projectRoot: string): Record<
  string,
  {
    executor: 'nx:run-commands';
    options: { command: string; cwd: string };
    cache: boolean;
    inputs: string[];
  }
> {
  return {
    format: {
      executor: 'nx:run-commands',
      options: {
        command: 'oxfmt --write .',
        cwd: projectRoot,
      },
      cache: false,
      inputs: OXFMT_INPUTS,
    },
    'format-check': {
      executor: 'nx:run-commands',
      options: {
        command: 'oxfmt --check .',
        cwd: projectRoot,
      },
      cache: true,
      inputs: OXFMT_INPUTS,
    },
  };
}
