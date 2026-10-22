import type { ExecutorContext } from '@nx/devkit'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { extractDiagramBlocks, TYPE_EXTENSIONS } from '../../blocks.ts'
import { diagramTypeFor, outputPathFor } from '../../plugin.ts'
import type { RenderExecutorSchema } from './schema.d.ts'

interface Resolved {
  commands: Record<string, string>
  companionImages: Record<string, string>
  format: 'svg' | 'png' | 'jpeg'
  krokiImage: string
  krokiUrl: string
  outputDir: string
  timeout: number
}

/**
 * Diagram types Kroki serves from a companion container.
 *
 * The gateway image bundles plantuml, graphviz and d2; mermaid, bpmn and
 * excalidraw are separate services the gateway reaches over the container
 * network (KROKI_MERMAID_HOST=mermaid and friends).
 */
const COMPANION_TYPES = ['bpmn', 'excalidraw', 'mermaid'] as const

/** The default companion image per type. */
function defaultCompanionImage(type: string): string {
  return `yuzutech/kroki-${type}:latest`
}

function resolveOptions(options: RenderExecutorSchema): Resolved {
  const format = options.format ?? 'svg'
  let krokiUrl = options.krokiUrl ?? 'https://kroki.io'
  while (krokiUrl.endsWith('/')) krokiUrl = krokiUrl.slice(0, -1)
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
  // spawnSync requires an integer timeout — fractional values throw RangeError.
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error(`timeout must be a positive integer of ms, got ${timeout}`)
  }
  const companionImages: Record<string, string> = {}
  for (const type of COMPANION_TYPES) {
    companionImages[type] = options.companionImages?.[type] ?? defaultCompanionImage(type)
  }
  return {
    commands,
    companionImages,
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

/**
 * The companion types the rendered diagrams need.
 *
 * Markdown sources carry diagram fences of different types — every block
 * type counts, so the set is a superset of what is actually rendered.
 */
function companionTypesFor(
  context: ExecutorContext,
  files: readonly string[],
  singleBlock: number | null | undefined,
  blocks: readonly (number | null | undefined)[] | undefined,
  commands: Record<string, string>,
): string[] {
  const types = new Set<string>()
  for (const [index, file] of files.entries()) {
    const blockIndex = singleBlock ?? blocks?.[index] ?? null
    if (blockIndex === null) {
      const type = diagramTypeFor(file)
      // A type with a command override never reaches Kroki — it needs no
      // companion container.
      if (type && !commands[type]) types.add(type)
      continue
    }
    // A missing or unreadable file is reported by the render loop with a
    // better message — here it only narrows the companion set.
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is a glob-matched workspace-relative path
      const source = readFileSync(join(context.root, file), 'utf8')
      const fileBlocks = extractDiagramBlocks(source)
      // Only the targeted block — a file with other diagram types must not
      // pull their companions in.
      const block = blockIndex >= 0 ? fileBlocks.at(blockIndex) : undefined
      if (block && !commands[block.type]) types.add(block.type)
    } catch {
      // ignore — the render loop fails with the real error
    }
  }
  return [...types].filter((type) => (COMPANION_TYPES as readonly string[]).includes(type))
}

/**
 * Create the per-run network the gateway and its companions share.
 */
function createDockerNetwork(network: string, image: string, timeoutMs: number): void {
  const created = spawnSync('docker', ['network', 'create', network], {
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  if (created.error || created.status !== 0) {
    const detail = created.error?.message ?? String(created.stderr).trim()
    throw new Error(`krokiUrl "docker": docker network create failed for ${image}: ${detail}`)
  }
}

/**
 * Start a companion container under its type name.
 */
function startCompanionContainer(
  type: string,
  image: string,
  network: string,
  timeoutMs: number,
  started: readonly string[],
): string {
  const run = spawnSync(
    'docker',
    ['run', '-d', '--rm', '--network', network, '--network-alias', type, image],
    { encoding: 'utf8', timeout: timeoutMs },
  )
  if (run.error || run.status !== 0) {
    const detail = run.error?.message ?? String(run.stderr).trim()
    stopDockerResources(network, started, timeoutMs)
    throw new Error(`krokiUrl "docker": docker run failed for ${image}: ${detail}`)
  }
  return String(run.stdout).trim()
}

/**
 * Start the gateway container, told where to find its companions.
 */
function startGatewayContainer(
  image: string,
  network: string,
  companionTypes: readonly string[],
  timeoutMs: number,
  started: readonly string[],
): string {
  const runArgs = ['run', '-d', '--rm', '-p', '127.0.0.1::8000', '--network', network]
  for (const type of companionTypes) {
    runArgs.push('-e', `KROKI_${type.toUpperCase()}_HOST=${type}`)
  }
  runArgs.push(image)
  const run = spawnSync('docker', runArgs, {
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  if (run.error || run.status !== 0) {
    const detail = run.error?.message ?? String(run.stderr).trim()
    stopDockerResources(network, started, timeoutMs)
    throw new Error(`krokiUrl "docker": docker run failed for ${image}: ${detail}`)
  }
  return String(run.stdout).trim()
}

/**
 * Stop the companion containers and remove the per-run network.
 *
 * Best effort: the first failure is reported, the rest still runs — a
 * leftover container must not hide the others.
 */
function stopDockerResources(
  network: string,
  companions: readonly string[],
  timeoutMs: number,
): Error | undefined {
  let firstError: Error | undefined
  for (const id of companions) {
    const res = spawnSync('docker', ['stop', id], { stdio: 'ignore', timeout: timeoutMs })
    if (res.error || res.status !== 0) {
      firstError ??= new Error(
        `krokiUrl "docker": docker stop failed for container ${id}: ${res.error?.message ?? `exit ${res.status}`}`,
      )
      // A container that refuses to stop stays attached to the network —
      // and `docker network rm` fails on a network with attached
      // containers. Force-remove it so the network can go.
      spawnSync('docker', ['rm', '-f', id], { stdio: 'ignore', timeout: timeoutMs })
    }
  }
  const removed = spawnSync('docker', ['network', 'rm', network], {
    stdio: 'ignore',
    timeout: timeoutMs,
  })
  if (removed.error || removed.status !== 0) {
    firstError ??= new Error(
      `krokiUrl "docker": docker network rm failed for ${network}: ${removed.error?.message ?? `exit ${removed.status}`}`,
    )
  }
  return firstError
}

// Serverless Kroki: one ephemeral container per executor invocation.
// `-p 127.0.0.1::8000` binds a random loopback port; `docker port` resolves it;
// `--rm` removes the container on stop.
//
// The gateway image bundles plantuml, graphviz and d2 only — mermaid, bpmn
// and excalidraw are companion services. They run on a per-run docker
// network under their type name, and the gateway is told where to find them
// (KROKI_MERMAID_HOST=mermaid and friends).
async function startDockerKroki(
  image: string,
  companionImages: Record<string, string>,
  companionTypes: readonly string[],
  timeoutMs: number,
): Promise<DockerKroki> {
  const network = `kroki-${randomUUID().slice(0, 8)}`
  createDockerNetwork(network, image, timeoutMs)

  // The gateway and the companions share the network; the companion is
  // reachable under its type name.
  const companions: string[] = []
  for (const type of companionTypes) {
    const companionImage = companionImages[type]
    if (!companionImage) continue
    companions.push(startCompanionContainer(type, companionImage, network, timeoutMs, companions))
  }

  const id = startGatewayContainer(image, network, companionTypes, timeoutMs, companions)
  const stop = (): Error | undefined => {
    // The container is --rm, but --rm only cleans up once the container
    // actually exits — a failed stop leaves it running, so report it.
    const res = spawnSync('docker', ['stop', id], { stdio: 'ignore', timeout: timeoutMs })
    if (res.error || res.status !== 0) {
      // The companions and the network are cleaned up even when the
      // gateway refuses to stop — otherwise they outlive the run.
      const cleanupError = stopDockerResources(network, companions, timeoutMs)
      return (
        cleanupError ??
        new Error(
          `krokiUrl "docker": docker stop failed for container ${id}: ${res.error?.message ?? `exit ${res.status}`}`,
        )
      )
    }
    return stopDockerResources(network, companions, timeoutMs)
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
  const deadline = Date.now() + resolved.timeout
  for (;;) {
    // Nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf -- krokiUrl is workspace config validated as absolute http(s); type/format come from fixed enums
    const res = await fetch(url, {
      body: source,
      headers: { 'content-type': 'text/plain' },
      method: 'POST',
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    })
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer())
    }
    const rawBody = await res.text().catch(() => '')
    const body = rawBody.slice(0, 500)
    // 502/503 is the gateway reporting that the service behind it (a
    // companion that is still starting) is unavailable — retry until the
    // budget is gone. Any other status is the diagram's own problem.
    if ((res.status !== 502 && res.status !== 503) || Date.now() >= deadline) {
      throw new Error(`Kroki ${url} failed with HTTP ${res.status}: ${body}`)
    }
    // The delay never outlives the budget.
    const remaining = deadline - Date.now()
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(200, remaining))))
  }
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

  // The companion set has to be known before the gateway container is
  // created — the gateway is told where to find its services then.
  const companionTypes =
    resolved.krokiUrl === 'docker'
      ? companionTypesFor(context, files, options.block ?? null, options.blocks, resolved.commands)
      : []

  let dockerKroki: DockerKroki | undefined
  let renderError: unknown
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
          dockerKroki ??= await startDockerKroki(
            resolved.krokiImage,
            resolved.companionImages,
            companionTypes,
            resolved.timeout,
          )
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
  } catch (error) {
    renderError = error
  } finally {
    const stopError = dockerKroki?.stop()
    if (stopError) {
      if (renderError === undefined) {
        // Renders succeeded but the container may still be running —
        // a silent success would leak it.
        renderError = stopError
      } else {
        // A render error is already pending — don't mask it.
        console.warn(stopError.message)
      }
    }
  }
  if (renderError !== undefined) throw renderError

  return { success: true }
}
