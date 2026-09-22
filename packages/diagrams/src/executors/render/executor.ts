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
  krokiImage: string
  krokiUrl: string
  outputDir: string
  timeout: number
}

function resolveOptions(options: RenderExecutorSchema): Resolved {
  const format = options.format ?? 'svg'
  const krokiUrl = (options.krokiUrl ?? 'https://kroki.io').replace(/\/+$/, '')
  if (krokiUrl && krokiUrl !== 'docker' && !/^https?:\/\//.test(krokiUrl)) {
    throw new Error(
      `krokiUrl must be an absolute http(s) URL or "docker", got "${options.krokiUrl}"`,
    )
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
    krokiImage: options.krokiImage ?? 'yuzutech/kroki:latest',
    krokiUrl,
    outputDir: options.outputDir ?? '{fileDir}',
    timeout,
  }
}

interface DockerKroki {
  stop: () => Error | undefined
  url: string
}

// Serverless Kroki: one ephemeral container per executor invocation.
// `-p 127.0.0.1::8000` binds a random loopback port; `docker port` resolves it;
// `--rm` removes the container on stop.
async function startDockerKroki(image: string, timeoutMs: number): Promise<DockerKroki> {
  const run = spawnSync('docker', ['run', '-d', '--rm', '-p', '127.0.0.1::8000', image], {
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  if (run.error || run.status !== 0) {
    const detail = run.error?.message ?? String(run.stderr).trim()
    throw new Error(`krokiUrl "docker": docker run failed for ${image}: ${detail}`)
  }
  const id = String(run.stdout).trim()
  const stop = (): Error | undefined => {
    // The container is --rm, but --rm only cleans up once the container
    // actually exits — a failed stop leaves it running, so report it.
    const res = spawnSync('docker', ['stop', id], { stdio: 'ignore', timeout: timeoutMs })
    if (res.error || res.status !== 0) {
      return new Error(
        `krokiUrl "docker": docker stop failed for container ${id}: ${res.error?.message ?? `exit ${res.status}`}`,
      )
    }
    return undefined
  }
  try {
    const port = spawnSync('docker', ['port', id, '8000'], { encoding: 'utf8', timeout: timeoutMs })
    if (port.error || port.status !== 0) {
      const detail = port.error?.message ?? String(port.stderr).trim()
      throw new Error(`krokiUrl "docker": docker port failed for container ${id}: ${detail}`)
    }
    const mapped = String(port.stdout).trim().split('\n')[0] ?? ''
    // docker port emits HOST:PORT — the port is always the last colon
    // segment, including bracketed IPv6 like [::1]:32768.
    const mappedPort = mapped.split(':').at(-1) ?? ''
    if (!/^\d+$/.test(mappedPort)) {
      throw new Error(`krokiUrl "docker": could not parse mapped port from "${mapped}"`)
    }
    const url = `http://127.0.0.1:${mappedPort}`
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        // Nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf -- url is a loopback origin built from `docker port` output, validated as digits above
        const res = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        })
        // res.ok is evaluated before the deadline check — a successful
        // response can never be masked by the timeout.
        if (res.ok) break
      } catch {
        // not up yet
      }
      if (Date.now() >= deadline) {
        throw new Error(`krokiUrl "docker": ${image} did not become healthy within ${timeoutMs}ms`)
      }
      // Cap the backoff by the remaining budget so `timeout` stays a hard upper bound.
      await new Promise((r) => setTimeout(r, Math.min(200, Math.max(1, deadline - Date.now()))))
    }
    return { stop, url }
  } catch (error) {
    // Startup already failed — a stop failure here is reported by callers'
    // finally path being unreachable, so warn rather than mask.
    const stopError = stop()
    if (stopError) console.warn(stopError.message)
    throw error
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

async function renderWithKroki(
  resolved: Resolved,
  krokiBase: string,
  type: string,
  source: string,
): Promise<Buffer> {
  const url = `${krokiBase}/${type}/${resolved.format}`
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

  let dockerKroki: DockerKroki | undefined
  try {
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
        // .at() returns T | undefined so the out-of-range check is honest to
        // typed lint — but .at(-1) wraps to the last element, so the >= 0
        // guard is load-bearing: without it a negative index would silently
        // render the wrong block instead of erroring.
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
        // "docker" mode starts lazily on the first Kroki render — command-only
        // and dryRun runs never touch the daemon.
        let krokiBase = resolved.krokiUrl
        if (krokiBase === 'docker') {
          dockerKroki ??= await startDockerKroki(resolved.krokiImage, resolved.timeout)
          krokiBase = dockerKroki.url
        }
        const source =
          blockSource ??
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is a glob-matched workspace-relative path joined to context.root
          readFileSync(join(context.root, file), 'utf8')
        const image = await renderWithKroki(resolved, krokiBase, type, source)
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- output derived from the same glob-matched path
        mkdirSync(dirname(absOutput), { recursive: true })
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- same as above
        writeFileSync(absOutput, image)
      }
      console.log(`${file} -> ${output}`)
    }
  } finally {
    const stopError = dockerKroki?.stop()
    if (stopError) console.warn(stopError.message)
  }

  return { success: true }
}
