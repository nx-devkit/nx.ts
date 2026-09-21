import type { ExecutorContext } from '@nx/devkit'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { extractDiagramBlocks, TYPE_EXTENSIONS } from '../../blocks.ts'
import { diagramTypeFor, outputPathFor } from '../../plugin.ts'
import type { RenderExecutorSchema } from './schema.d.ts'

interface Resolved {
  commands: Record<string, string>
  format: 'svg' | 'png' | 'jpeg'
  krokiUrl: string
  outputDir: string
  timeout: number
}

function resolveOptions(options: RenderExecutorSchema): Resolved {
  const format = options.format ?? 'svg'
  const krokiUrl = (options.krokiUrl ?? 'https://kroki.io').replace(/\/+$/, '')
  if (krokiUrl && !/^https?:\/\//.test(krokiUrl)) {
    throw new Error(`krokiUrl must be an absolute http(s) URL, got "${options.krokiUrl}"`)
  }
  const commands = options.commands ?? {}
  if (!krokiUrl && Object.keys(commands).length === 0 && !options.dryRun) {
    throw new Error('No renderer configured: set krokiUrl or provide commands for diagram types')
  }
  const timeout = options.timeout ?? 30_000
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`timeout must be a positive number of ms, got ${timeout}`)
  }
  return {
    commands,
    format,
    krokiUrl,
    outputDir: options.outputDir ?? '{fileDir}',
    timeout,
  }
}

// Values expand shell-quoted so paths with spaces/metacharacters stay single arguments.
// Command authors must not wrap placeholders in their own quotes.
function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) return value
  // Cmd.exe does not treat single quotes as quoting; wrap in double quotes
  // And double any inner double quotes instead.
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    // eslint-disable-next-line security/detect-object-injection -- key comes from {name} placeholders in a workspace-authored command template
    const value = vars[key] as string | undefined
    return value === undefined ? `{${key}}` : shellQuote(value)
  })
}

async function renderWithKroki(resolved: Resolved, type: string, source: string): Promise<Buffer> {
  const url = `${resolved.krokiUrl}/${type}/${resolved.format}`
  // Nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf -- krokiUrl is workspace config validated as absolute http(s); type/format come from fixed enums
  const res = await fetch(url, {
    body: source,
    headers: { 'content-type': 'text/plain' },
    method: 'POST',
    signal: AbortSignal.timeout(resolved.timeout),
  })
  if (!res.ok) {
    const rawBody = await res.text().catch(() => '')
    const body = rawBody.slice(0, 500)
    throw new Error(`Kroki ${url} failed with HTTP ${res.status}: ${body}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

function renderWithCommand(
  resolved: Resolved,
  command: string,
  vars: Record<string, string>,
  cwd: string,
): void {
  const cmd = interpolate(command, vars)
  // Nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- commands are workspace-authored config (same trust level as nx:run-commands); shell is required for pipes/redirects
  const result = spawnSync(cmd, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: resolved.timeout,
  })
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ETIMEDOUT') {
      throw new Error(`Diagram command timed out after ${resolved.timeout}ms: ${cmd}`)
    }
    throw new Error(`Diagram command failed to start: ${result.error.message}`)
  }
  if (result.signal) {
    throw new Error(`Diagram command killed by signal ${result.signal}: ${cmd}`)
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr).trim()
    throw new Error(`Diagram command failed (exit ${result.status}): ${cmd}\n${stderr}`)
  }
}

export default async function renderExecutor(
  options: RenderExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const resolved = resolveOptions(options)
  const files = options.file ? [options.file] : (options.files ?? [])
  if (files.length === 0) {
    throw new Error('render executor requires `file` or `files`')
  }
  if (options.blocks !== undefined && options.blocks.length !== files.length) {
    throw new Error(
      `blocks (${options.blocks.length}) must align with files (${files.length}) — use null for whole-file entries`,
    )
  }

  const outputsOption = options.file ? [options.output] : (options.outputs ?? [])
  const projectRoot = context.projectName
    ? (context.projectsConfigurations?.projects[context.projectName]?.root ?? '.')
    : '.'

  for (const [index, file] of files.entries()) {
    // Markdown sources carry a diagram-fence index; the executor re-extracts
    // the block body — the plugin only declares count/outputs at inference.
    // eslint-disable-next-line security/detect-object-injection -- index iterates the declared files array
    const blockIndex = options.file ? (options.block ?? null) : (options.blocks?.[index] ?? null)
    let type: string
    let blockSource: string | undefined
    if (blockIndex !== null) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is a glob-matched workspace-relative path
      const blocks = extractDiagramBlocks(readFileSync(join(context.root, file), 'utf8'))
      // .at() types the result as possibly-undefined; indexing would too,
      // but .at() makes the out-of-range case explicit to the type system.
      const block = blockIndex >= 0 ? blocks.at(blockIndex) : undefined
      if (!block) {
        throw new Error(
          `${file} has ${blocks.length} diagram block(s); block ${blockIndex} is out of range`,
        )
      }
      type = block.type
      blockSource = block.source
    } else {
      const fileType = diagramTypeFor(file)
      if (!fileType) {
        throw new Error(`Unknown diagram type for ${file}`)
      }
      type = fileType
    }
    // An explicit output path is part of the inferred Nx output contract:
    // Its extension must match the resolved format, otherwise the artifact
    // Written at runtime would diverge from the declared target outputs.
    const declared =
      // eslint-disable-next-line security/detect-object-injection -- index iterates files; outputsOption may be shorter, guarded by the ?? fallback
      outputsOption[index] ??
      outputPathFor(
        file,
        projectRoot,
        resolved.outputDir,
        resolved.format,
        blockIndex !== null ? `-${blockIndex + 1}` : '',
      )
    const declaredExt = extname(declared).replace(/^\./, '').toLowerCase()
    if (declaredExt && declaredExt !== resolved.format) {
      throw new Error(
        `output "${declared}" declares .${declaredExt} but format is ${resolved.format}; adjust the format or the output path`,
      )
    }
    const output = (declaredExt ? declared : `${declared}.${resolved.format}`).replace(/\\/g, '/')
    if (isAbsolute(output) || output.split('/').includes('..')) {
      throw new Error(`output path "${output}" must resolve inside the workspace`)
    }
    const absOutput = resolve(context.root, output)
    const rel = relative(context.root, absOutput)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`output path "${output}" must resolve inside the workspace`)
    }
    const fileDir = dirname(file)

    if (options.dryRun) {
      console.log(
        `[dryRun] would render ${file}${blockIndex !== null ? ` block ${blockIndex}` : ''} -> ${output}`,
      )
      continue
    }

    const vars = {
      fileDir,
      fileName:
        basename(file).replace(/\.[a-z0-9]+$/i, '') +
        (blockIndex !== null ? `-${blockIndex + 1}` : ''),
      format: resolved.format,
      input: file,
      output,
      projectRoot,
    }

    // eslint-disable-next-line security/detect-object-injection -- type comes from the fixed DIAGRAM_TYPES registry
    const command = resolved.commands[type]
    if (command) {
      // Block bodies aren't files — commands take a path, so materialize a
      // temp input carrying the type's canonical extension. mkdtempSync
      // gives an atomically unique dir — no races between parallel runs.
      // The input is named after the diagram (vars.fileName carries the
      // block suffix) so commands deriving the output name from {input}
      // keep working.
      let tmpDir: string | undefined
      try {
        if (blockSource !== undefined) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- tmpdir() is the OS temp dir
          mkdirSync(tmpdir(), { recursive: true })
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed prefix under the OS temp dir
          tmpDir = mkdtempSync(join(tmpdir(), 'nx-diagrams-'))
          // eslint-disable-next-line security/detect-object-injection -- type comes from the fixed registry
          const input = join(tmpDir, `${vars.fileName}${TYPE_EXTENSIONS[type] ?? '.txt'}`)
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside a fresh unique tmpdir
          writeFileSync(input, blockSource)
          vars.input = input
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- output derived from a glob-matched path under the trusted workspace root
        mkdirSync(dirname(absOutput), { recursive: true })
        // A stale file must not satisfy the post-command existence check.
        rmSync(absOutput, { force: true })
        renderWithCommand(resolved, command, vars, context.root)
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- same as above
        if (!existsSync(absOutput)) {
          throw new Error(`Diagram command succeeded but did not create ${output}`)
        }
      } finally {
        if (tmpDir) {
          rmSync(tmpDir, { force: true, recursive: true })
        }
      }
    } else {
      if (!resolved.krokiUrl) {
        throw new Error(
          `No renderer for ${file} (type ${type}): krokiUrl is empty — configure commands.${type} or set krokiUrl`,
        )
      }
      const source =
        blockSource ??
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is a glob-matched workspace-relative path joined to context.root
        readFileSync(join(context.root, file), 'utf8')
      const image = await renderWithKroki(resolved, type, source)
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- output derived from the same glob-matched path
      mkdirSync(dirname(absOutput), { recursive: true })
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same as above
      writeFileSync(absOutput, image)
    }
    console.log(`${file} -> ${output}`)
  }

  return { success: true }
}
