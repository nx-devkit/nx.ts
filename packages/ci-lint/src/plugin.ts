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

const IS_WINDOWS = process.platform === 'win32';
/** Shared failure flag: each leg flips it instead of short-circuiting the rest. */
const FAIL_FLAG = 'ci_lint_failed';

/**
 * `nx:run-commands` goes through the platform shell — quote for the shell that
 * will run the target. POSIX sh gets single-quote escaping; cmd.exe has no
 * single quote and still expands `%VAR%`/`!VAR!` inside double quotes, so a
 * value containing `"`, `%`, `!`, or a control character cannot be quoted
 * safely on Windows and fails loud instead of producing a broken command.
 */
function q(value: string): string {
  if (IS_WINDOWS) {
    const hasControlChar = [...value].some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x20 || (code >= 0x7f && code <= 0x9f);
    });
    if (hasControlChar || /["%!]/.test(value)) {
      throw new Error(`ci-lint: ${JSON.stringify(value)} cannot be quoted safely for cmd.exe`);
    }
    return `"${value}"`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Both tools are optional: the leg probes the tool on PATH and echoes a skip
 * line instead of failing when the binary is absent. A failed run flips
 * FAIL_FLAG rather than aborting the command, so every installed tool still
 * runs (and still produces its output, e.g. the zizmor SARIF file) when an
 * earlier leg found violations.
 */
function toolLeg(tool: string, run: string): string {
  const skip = `ci-lint: ${tool} not found on PATH — skipping`;
  if (IS_WINDOWS) {
    // echo prints surrounding quotes literally on cmd.exe — the skip text is a
    // fixed constant without shell metachars, so it goes unquoted.
    return `where ${tool} >nul 2>nul && (${run} || set "${FAIL_FLAG}=1") || echo ${skip}`;
  }
  return `if command -v ${tool} >/dev/null 2>&1; then ${run} || ${FAIL_FLAG}=1; else echo ${q(skip)}; fi`;
}

/** Whitespace-split each arg token and quote it — raw interpolation is shell injection. */
function quoteArgs(args: string | undefined): string {
  return args ? ` ${args.trim().split(/\s+/).filter(Boolean).map(q).join(' ')}` : '';
}

function buildCommand(options: NxCiLintPluginOptions): string | null {
  const legs: string[] = [];
  if (options.actionlint !== false) {
    // Bare actionlint scans .github/workflows/ relative to cwd ({projectRoot}
    // is the workspace root for the root project).
    legs.push(toolLeg('actionlint', `actionlint${quoteArgs(options.actionlintArgs)}`));
  }
  if (options.zizmor !== false) {
    const format = q(options.zizmorFormat ?? 'plain');
    const redirect = options.zizmorOutput ? ` > ${q(options.zizmorOutput)}` : '';
    legs.push(
      toolLeg(
        'zizmor',
        `zizmor --format ${format}${quoteArgs(options.zizmorArgs)} ${q(WORKFLOWS_DIR)}${redirect}`,
      ),
    );
  }
  if (legs.length === 0) return null;
  return IS_WINDOWS
    ? `set "${FAIL_FLAG}=" & ${legs.join(' & ')} & if defined ${FAIL_FLAG} (exit 1)`
    : `${FAIL_FLAG}=0; ${legs.join('; ')}; exit "$${FAIL_FLAG}"`;
}

/**
 * `cache: true` would otherwise replay a successful *skip* forever, so the
 * hash must see the tool itself: this runtime input captures `tool --version`
 * output (empty-ish when the tool is absent — status + stderr still differ),
 * busting the cache when a tool is installed or upgraded. It runs through
 * `node -e` with `shell: true` so the probe is identical on sh and cmd.exe —
 * and always exits 0, which runtime inputs require.
 */
function toolRuntimeInput(tool: string): { runtime: string } {
  return {
    runtime: `node -e "const r=require('node:child_process').spawnSync('${tool}',['--version'],{shell:true});process.stdout.write(String(r.status)+(r.stdout||'')+(r.stderr||''))"`,
  };
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

    // Tool config edits must bust the cache alongside workflow edits; tool
    // installs/upgrades bust it via the runtime --version inputs.
    const inputs: TargetConfiguration['inputs'] = [
      `{workspaceRoot}/${WORKFLOWS_GLOB}`,
      '{workspaceRoot}/.github/actionlint.yaml',
      '{workspaceRoot}/.github/actionlint.yml',
      '{workspaceRoot}/.github/zizmor.yml',
      '{workspaceRoot}/.github/zizmor.yaml',
      '{workspaceRoot}/zizmor.yml',
      '{workspaceRoot}/zizmor.yaml',
      ...(options.actionlint !== false ? [toolRuntimeInput('actionlint')] : []),
      ...(options.zizmor !== false ? [toolRuntimeInput('zizmor')] : []),
    ];

    const targets: Record<string, TargetConfiguration> = {
      [targetName]: {
        executor: 'nx:run-commands',
        cache: true,
        inputs,
        options: { command, cwd: '{projectRoot}' },
        ...(options.zizmorOutput ? { outputs: [`{workspaceRoot}/${options.zizmorOutput}`] } : {}),
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
