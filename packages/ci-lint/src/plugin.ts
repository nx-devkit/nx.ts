import { dirname } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';

export interface NxCiLintPluginOptions {
  /** Name of the target inferred on the root project. Default: "lint-ci". */
  targetName?: string;
  /** Lint workflows with actionlint when it is on PATH. Default: true. */
  actionlint?: boolean;
  /** Audit workflows with zizmor when it is on PATH. Default: true. */
  zizmor?: boolean;
  /** Extra arguments appended to the actionlint invocation. Default: "". */
  actionlintArgs?: string;
  /** Extra arguments appended to the zizmor invocation, before the input dir. Default: "". */
  zizmorArgs?: string;
  /**
   * Value passed to `zizmor --format`. "sarif" produces output suitable for
   * GitHub code-scanning upload. Default: "plain".
   */
  zizmorFormat?: 'plain' | 'json' | 'sarif';
  /**
   * Redirect zizmor output to this workspace-relative file instead of stdout
   * (e.g. "zizmor.sarif" for `codeql-action/upload-sarif`).
   */
  zizmorOutput?: string;
}

const WORKFLOWS_DIR = '.github/workflows';
const WORKFLOWS_GLOB: string = `${WORKFLOWS_DIR}/*.{yml,yaml}`;

/** POSIX single-quote escaping for values interpolated into the shell command. */
function sq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Both tools are optional: the leg probes `command -v` and echoes a skip line
 * instead of failing when the binary is not on PATH. Legs join with `&&` so a
 * real lint failure in any installed tool still fails the target.
 */
function toolLeg(tool: string, run: string): string {
  return `if command -v ${tool} >/dev/null 2>&1; then ${run}; else echo ${sq(`ci-lint: ${tool} not found on PATH — skipping`)}; fi`;
}

function buildCommand(options: NxCiLintPluginOptions): string | null {
  const legs: string[] = [];
  if (options.actionlint !== false) {
    const args = options.actionlintArgs ? ` ${options.actionlintArgs}` : '';
    // Bare actionlint scans .github/workflows/ relative to cwd ({projectRoot}
    // is the workspace root for the root project).
    legs.push(toolLeg('actionlint', `actionlint${args}`));
  }
  if (options.zizmor !== false) {
    const format = options.zizmorFormat ?? 'plain';
    const args = options.zizmorArgs ? ` ${options.zizmorArgs}` : '';
    const redirect = options.zizmorOutput ? ` > ${sq(options.zizmorOutput)}` : '';
    legs.push(
      toolLeg('zizmor', `zizmor --format ${format}${args} ${sq(WORKFLOWS_DIR)}${redirect}`),
    );
  }
  return legs.length === 0 ? null : legs.join(' && ');
}

export const createNodesV2: CreateNodesV2<NxCiLintPluginOptions> = [
  WORKFLOWS_GLOB,
  (configFiles, options = {}, _context) => {
    const targetName = options.targetName ?? 'lint-ci';
    const command = buildCommand(options);
    if (command === null) return [];

    // Workflow files are repo-wide — only the root .github/workflows/ counts.
    const workflows = configFiles
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => dirname(f) === WORKFLOWS_DIR)
      .sort();
    const anchor = workflows[0];
    if (anchor === undefined) return [];

    // Tool config edits must bust the cache alongside workflow edits.
    const inputs = [
      `{workspaceRoot}/${WORKFLOWS_GLOB}`,
      '{workspaceRoot}/.github/actionlint.yaml',
      '{workspaceRoot}/.github/actionlint.yml',
      '{workspaceRoot}/.github/zizmor.yml',
      '{workspaceRoot}/.github/zizmor.yaml',
      '{workspaceRoot}/zizmor.yml',
      '{workspaceRoot}/zizmor.yaml',
    ];

    const targets: Record<string, TargetConfiguration> = {
      [targetName]: {
        executor: 'nx:run-commands',
        cache: true,
        inputs,
        options: { command, cwd: '{projectRoot}' },
      },
    };

    const results: (readonly [string, { projects: Record<string, ProjectConfiguration> }])[] = [
      [anchor, { projects: { '.': { root: '.', targets } } }],
    ];
    return results;
  },
];

export default createNodesV2;

export const __testing: {
  WORKFLOWS_GLOB: typeof WORKFLOWS_GLOB;
  buildCommand: typeof buildCommand;
} = {
  WORKFLOWS_GLOB: WORKFLOWS_GLOB,
  buildCommand: buildCommand,
};
