import type { ExecutorContext } from '@nx/devkit'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  return {
    commands: options.commands ?? {},
    format,
    krokiUrl,
    outputDir: options.outputDir ?? '{fileDir}',
    timeout: options.timeout ?? 30_000,
  }
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`)
}

async function renderWithKroki(resolved: Resolved, type: string, source: string): Promise<Buffer> {
  const url = `${resolved.krokiUrl}/${type}/${resolved.format}`
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
  const result = spawnSync(cmd, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: resolved.timeout,
  })
  if (result.error) {
    throw new Error(`Diagram command failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? ''
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

  const rendered: string[] = []
  for (const file of files) {
    const type = diagramTypeFor(file)
    if (!type) {
      throw new Error(`Unknown diagram type for ${file}`)
    }
    const projectRoot = context.projectName
      ? (context.projectsConfigurations?.projects[context.projectName]?.root ?? '.')
      : '.'
    const output = outputPathFor(file, projectRoot, resolved.outputDir, resolved.format)
    const absOutput = join(context.root, output)
    const fileDir = dirname(file)

    if (options.dryRun) {
      console.log(`[dryRun] would render ${file} -> ${output}`)
      rendered.push(output)
      continue
    }

    const vars = {
      fileDir,
      fileName: (file.split('/').pop() ?? file).replace(/\.[a-z0-9]+$/i, ''),
      format: resolved.format,
      input: file,
      output,
      projectRoot,
    }

    const command = resolved.commands[type]
    if (command) {
      mkdirSync(dirname(absOutput), { recursive: true })
      renderWithCommand(resolved, command, vars, context.root)
      if (!existsSync(absOutput)) {
        throw new Error(`Diagram command succeeded but did not create ${output}`)
      }
    } else {
      if (!resolved.krokiUrl) {
        throw new Error(
          `No renderer for ${file} (type ${type}): krokiUrl is empty — configure commands.${type} or set krokiUrl`,
        )
      }
      const source = readFileSync(join(context.root, file), 'utf8')
      const image = await renderWithKroki(resolved, type, source)
      mkdirSync(dirname(absOutput), { recursive: true })
      writeFileSync(absOutput, image)
    }
    rendered.push(output)
    console.log(`${file} -> ${output}`)
  }

  return { success: true }
}
