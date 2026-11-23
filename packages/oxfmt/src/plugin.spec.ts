import type { CreateNodesContextV2 } from 'nx/src/project-graph/plugins/public-api';
import { describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    nxJsonConfiguration: {},
    workspaceRoot,
  } as unknown as CreateNodesContextV2;
}

describe('@nx-devkit/oxfmt createNodesV2', () => {
  it('returns empty array when no oxfmt config files are matched', async () => {
    const result = await createNodesV2[1]([], {}, makeContext('/workspace'));
    expect(result).toEqual([]);
  });

  it('infers format and format-check targets for a .oxfmtrc.json project', async () => {
    const workspaceRoot = '/workspace';
    const configFile = 'packages/lib/.oxfmtrc.json';
    const result = await createNodesV2[1]([configFile], {}, makeContext(workspaceRoot));

    expect(result).toHaveLength(1);
    const [file, project] = result[0]!;
    expect(file).toBe(configFile);

    const projectRoot = 'packages/lib';
    const targets = project.projects?.[projectRoot]?.targets;
    expect(targets).toBeDefined();

    expect(targets!.format).toBeDefined();
    expect(targets!['format-check']).toBeDefined();
  });

  it('format target writes files, is uncached, and runs in projectRoot', async () => {
    const result = await createNodesV2[1](
      ['apps/demo/.oxfmtrc.json'],
      {},
      makeContext('/workspace'),
    );
    const targets = result[0]![1].projects?.['apps/demo']?.targets;
    const format = targets!.format!;
    expect(format.executor).toBe('nx:run-commands');
    expect((format.options as { command: string }).command).toBe('oxfmt --write .');
    expect((format.options as { cwd: string }).cwd).toBe('apps/demo');
    expect(format.cache).toBe(false);
  });

  it('format-check target is read-only and cacheable', async () => {
    const result = await createNodesV2[1](
      ['apps/demo/.oxfmtrc.json'],
      {},
      makeContext('/workspace'),
    );
    const targets = result[0]![1].projects?.['apps/demo']?.targets;
    const check = targets!['format-check']!;
    expect(check.executor).toBe('nx:run-commands');
    expect((check.options as { command: string }).command).toBe('oxfmt --check .');
    expect((check.options as { cwd: string }).cwd).toBe('apps/demo');
    expect(check.cache).toBe(true);
  });

  it('inputs include the oxfmt config file and project files', async () => {
    const result = await createNodesV2[1](
      ['apps/demo/.oxfmtrc.json'],
      {},
      makeContext('/workspace'),
    );
    const targets = result[0]![1].projects?.['apps/demo']?.targets;
    const formatInputs = targets!.format!.inputs as string[];
    expect(formatInputs).toContain('{projectRoot}/.oxfmtrc.json');
    expect(formatInputs).toContain('{projectRoot}/**/*');
  });

  it.each(['.oxfmtrc.json', '.oxfmtrc.jsonc', 'oxfmt.config.ts', 'oxfmt.config.mts'])(
    'recognizes %s as an oxfmt config',
    async (basename) => {
      const result = await createNodesV2[1](
        [`apps/demo/${basename}`],
        {},
        makeContext('/workspace'),
      );
      expect(result).toHaveLength(1);
      const targets = result[0]![1].projects?.['apps/demo']?.targets;
      expect(targets!.format).toBeDefined();
      expect(targets!['format-check']).toBeDefined();
    },
  );

  it('keeps the matched config basename in the target inputs', async () => {
    const result = await createNodesV2[1](
      ['apps/demo/oxfmt.config.ts'],
      {},
      makeContext('/workspace'),
    );
    const targets = result[0]![1].projects?.['apps/demo']?.targets;
    const formatInputs = targets!.format!.inputs as string[];
    expect(formatInputs).toContain('{projectRoot}/oxfmt.config.ts');
  });

  it('dedupes a project when several config forms exist in one directory', async () => {
    const result = await createNodesV2[1](
      ['apps/demo/.oxfmtrc.json', 'apps/demo/.oxfmtrc.jsonc'],
      {},
      makeContext('/workspace'),
    );
    // oxfmt allows only one config per directory; if several sneak in, the
    // plugin still emits a single project entry instead of overwriting it.
    expect(result).toHaveLength(1);
  });

  it('honors command overrides from plugin options', async () => {
    const result = await createNodesV2[1](
      ['apps/demo/.oxfmtrc.json'],
      { formatCommand: 'oxfmt --write src', formatCheckCommand: 'oxfmt --check src' },
      makeContext('/workspace'),
    );
    const targets = result[0]![1].projects?.['apps/demo']?.targets;
    expect((targets!.format!.options as { command: string }).command).toBe('oxfmt --write src');
    expect((targets!['format-check']!.options as { command: string }).command).toBe(
      'oxfmt --check src',
    );
  });

  it('skips workspace root (.oxfmtrc.json at workspace root)', async () => {
    const result = await createNodesV2[1](['.oxfmtrc.json'], {}, makeContext('/workspace'));
    expect(result).toEqual([]);
  });

  it('skips a workspace-root oxfmt.config.ts', async () => {
    const result = await createNodesV2[1](['oxfmt.config.ts'], {}, makeContext('/workspace'));
    expect(result).toEqual([]);
  });

  it('skips configs inside node_modules', async () => {
    const result = await createNodesV2[1](
      ['node_modules/pkg/.oxfmtrc.json'],
      {},
      makeContext('/workspace'),
    );
    expect(result).toEqual([]);
  });

  it('skips configs that escape the workspace root', async () => {
    const result = await createNodesV2[1](
      ['../outside/.oxfmtrc.json'],
      {},
      makeContext('/workspace'),
    );
    expect(result).toEqual([]);
  });

  it('exports the createNodesV2 tuple with a glob matching every config form', () => {
    expect(createNodesV2[0]).toContain('.oxfmtrc.json');
    expect(createNodesV2[0]).toContain('.oxfmtrc.jsonc');
    expect(createNodesV2[0]).toContain('oxfmt.config.ts');
    expect(createNodesV2[0]).toContain('oxfmt.config.mts');
  });

  it('plugin name is exposed for nx registration', async () => {
    const mod = await import('./plugin.ts');
    expect(mod.default.name).toBe('@nx-devkit/oxfmt');
    expect(typeof mod.createNodesV2).toBe('object');
  });
});
