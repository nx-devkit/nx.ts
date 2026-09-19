import type { ExecutorContext } from '@nx/devkit'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
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
  return /^[a-zA-Z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

function interpolate(template: string, vars: Record<string, string>): string {
  // eslint-disable-next-line security/detect-object-injection -- key comes from {name} placeholders in a workspace-authored command template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key]
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

  const outputsOption = options.file ? [options.output] : (options.outputs ?? [])
  const projectRoot = context.projectName
    ? (context.projectsConfigurations?.projects[context.projectName]?.root ?? '.')
    : '.'

  for (const [index, file] of files.entries()) {
    const type = diagramTypeFor(file)
    if (!type) {
      throw new Error(`Unknown diagram type for ${file}`)
    }
    const output =
      outputsOption[index] ?? outputPathFor(file, projectRoot, resolved.outputDir, resolved.format)
    if (isAbsolute(output) || normalize(output).split('/').includes('..')) {
      throw new Error(`output path "${output}" must resolve inside the workspace`)
    }
    const absOutput = join(context.root, output)
    const fileDir = dirname(file)

    if (options.dryRun) {
      console.log(`[dryRun] would render ${file} -> ${output}`)
      continue
    }

    const vars = {
      fileDir,
      fileName: basename(file).replace(/\.[a-z0-9]+$/i, ''),
      format: resolved.format,
      input: file,
      output,
      projectRoot,
    }

    // eslint-disable-next-line security/detect-object-injection -- type comes from the fixed DIAGRAM_TYPES registry
    const command = resolved.commands[type]
    if (command) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- output derived from a glob-matched path under the trusted workspace root
      mkdirSync(dirname(absOutput), { recursive: true })
      // A stale file must not satisfy the post-command existence check.
      rmSync(absOutput, { force: true })
      renderWithCommand(resolved, command, vars, context.root)
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same as above
      if (!existsSync(absOutput)) {
        throw new Error(`Diagram command succeeded but did not create ${output}`)
      }
    } else {
      if (!resolved.krokiUrl) {
        throw new Error(
          `No renderer for ${file} (type ${type}): krokiUrl is empty — configure commands.${type} or set krokiUrl`,
        )
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is a glob-matched workspace-relative path joined to context.root
      const source = readFileSync(join(context.root, file), 'utf8')
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
