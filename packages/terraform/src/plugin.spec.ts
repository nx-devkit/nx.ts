import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-terraform-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('@nx-devkit/terraform createNodesV2', () => {
  it('triggers on *.tf files', () => {
    expect(createNodesV2[0]).toBe('**/*.tf');
  });

  it('groups *.tf files by owning directory — one module project per dir', async () => {
    const root = makeWorkspace({
      'infra/vpc/main.tf': 'resource "aws_vpc" "main" {}',
      'infra/vpc/outputs.tf': '',
      'infra/eks/main.tf': '',
    });
    const results = await createNodesV2[1](
      ['infra/vpc/main.tf', 'infra/vpc/outputs.tf', 'infra/eks/main.tf'],
      {},
      makeContext(root),
    );

    expect(results).toHaveLength(2);
    const roots = results.flatMap(([, r]) => Object.keys(r.projects ?? {}));
    expect(roots.sort()).toEqual(['infra/eks', 'infra/vpc']);
  });

  it('infers tf:fmt, tf:validate, tf:plan on each module', async () => {
    const root = makeWorkspace({ 'infra/vpc/main.tf': '' });
    const results = await createNodesV2[1](['infra/vpc/main.tf'], {}, makeContext(root));

    const targets = results[0]![1].projects!['infra/vpc']!.targets!;
    expect(Object.keys(targets).sort()).toEqual(['tf:fmt', 'tf:plan', 'tf:validate']);
  });

  it('tf:fmt runs terraform fmt -check via -chdir and is cached', async () => {
    const root = makeWorkspace({ 'infra/vpc/main.tf': '' });
    const results = await createNodesV2[1](['infra/vpc/main.tf'], {}, makeContext(root));

    const target = results[0]![1].projects!['infra/vpc']!.targets!['tf:fmt']!;
    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({
      command: 'terraform -chdir=infra/vpc fmt -check',
      cwd: '{workspaceRoot}',
    });
    expect(target.cache).toBe(true);
    expect(target.inputs).toEqual(
      expect.arrayContaining(['{projectRoot}/*.tf', '{projectRoot}/*.tfvars']),
    );
  });

  it('tf:validate chains init -backend=false before validate and is cached', async () => {
    const root = makeWorkspace({ 'infra/vpc/main.tf': '' });
    const results = await createNodesV2[1](['infra/vpc/main.tf'], {}, makeContext(root));

    const target = results[0]![1].projects!['infra/vpc']!.targets!['tf:validate']!;
    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({
      command:
        'terraform -chdir=infra/vpc init -backend=false -input=false && terraform -chdir=infra/vpc validate',
      cwd: '{workspaceRoot}',
    });
    expect(target.cache).toBe(true);
  });

  it('tf:plan runs plan -input=false, is never cached, and documents the env-credentials requirement', async () => {
    const root = makeWorkspace({ 'infra/vpc/main.tf': '' });
    const results = await createNodesV2[1](['infra/vpc/main.tf'], {}, makeContext(root));

    const target = results[0]![1].projects!['infra/vpc']!.targets!['tf:plan']!;
    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({
      command: 'terraform -chdir=infra/vpc plan -input=false',
      cwd: '{workspaceRoot}',
    });
    expect(target.cache).toBe(false);
    expect(target.metadata?.description).toMatch(/env/i);
    expect(target.metadata?.description).toMatch(/credential/i);
  });

  it('never interpolates variables or credentials into commands', async () => {
    const root = makeWorkspace({ 'infra/vpc/main.tf': '' });
    const results = await createNodesV2[1](['infra/vpc/main.tf'], {}, makeContext(root));

    const targets = results[0]![1].projects!['infra/vpc']!.targets!;
    for (const target of Object.values(targets)) {
      const cmd = (target.options as { command: string }).command;
      expect(cmd).not.toMatch(/-var\b/);
      expect(cmd).not.toMatch(/TF_VAR_/);
      expect(cmd).not.toMatch(/AWS_/i);
      expect(cmd).not.toMatch(/\.tfvars/);
    }
  });

  it('supports the workspace root as a module (-chdir=.)', async () => {
    const root = makeWorkspace({ 'main.tf': '' });
    const results = await createNodesV2[1](['main.tf'], {}, makeContext(root));

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!['']!.targets!;
    expect(targets['tf:fmt']!.options).toEqual({
      command: 'terraform -chdir=. fmt -check',
      cwd: '{workspaceRoot}',
    });
  });

  it('binary: tofu switches every command to tofu', async () => {
    const root = makeWorkspace({ 'infra/vpc/main.tf': '' });
    const results = await createNodesV2[1](
      ['infra/vpc/main.tf'],
      { binary: 'tofu' },
      makeContext(root),
    );

    const targets = results[0]![1].projects!['infra/vpc']!.targets!;
    for (const name of ['tf:fmt', 'tf:validate', 'tf:plan']) {
      const cmd = (targets[name]!.options as { command: string }).command;
      expect(cmd.startsWith('tofu ')).toBe(true);
      expect(cmd).not.toContain('terraform -chdir');
    }
  });

  it('targetPrefix renames the inferred targets', async () => {
    const root = makeWorkspace({ 'infra/vpc/main.tf': '' });
    const results = await createNodesV2[1](
      ['infra/vpc/main.tf'],
      { targetPrefix: 'terraform' },
      makeContext(root),
    );

    const targets = results[0]![1].projects!['infra/vpc']!.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'terraform:fmt',
      'terraform:plan',
      'terraform:validate',
    ]);
  });

  it('skips modules inside node_modules and .terraform dirs', async () => {
    const root = makeWorkspace({
      'node_modules/x/main.tf': '',
      'infra/vpc/.terraform/modules/m/main.tf': '',
    });
    const results = await createNodesV2[1](
      ['node_modules/x/main.tf', 'infra/vpc/.terraform/modules/m/main.tf'],
      {},
      makeContext(root),
    );
    expect(results).toHaveLength(0);
  });

  it('skips files escaping the workspace', async () => {
    const root = makeWorkspace();
    const results = await createNodesV2[1](['../outside/main.tf'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('excludes .terraform/** from inputs so init output never poisons the cache', async () => {
    const root = makeWorkspace({ 'infra/vpc/main.tf': '' });
    const results = await createNodesV2[1](['infra/vpc/main.tf'], {}, makeContext(root));

    const inputs = results[0]![1].projects!['infra/vpc']!.targets!['tf:validate']!.inputs!;
    expect(inputs).toContain('!{projectRoot}/.terraform/**');
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/main.tf': '',
      'b/main.tf': '',
      'a/vars.tf': '',
    });
    const files = ['a/main.tf', 'b/main.tf', 'a/vars.tf'];
    const fwd = await createNodesV2[1](files, {}, makeContext(root));
    const rev = await createNodesV2[1](files.toReversed(), {}, makeContext(root));
    expect(fwd).toEqual(rev);
  });
});
