import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative } from 'node:path'

export interface NxDiagramsPluginOptions {
  /** Aggregate target name. Default: 'diagrams'. */
  targetName?: string
  /** Output image format. Default: 'svg'. */
  format?: 'svg' | 'png' | 'jpeg'
  /** Kroki base URL. Default: 'https://kroki.io'. Empty string disables Kroki. */
  krokiUrl?: string
  /**
   * Output directory template, workspace-relative.
   * Tokens: {fileDir} {fileName} {projectRoot}. Default: '{fileDir}'.
   */
  outputDir?: string
  /** Per-type local command overrides, e.g. { mermaid: 'mmdc -i {input} -o {output}' }. */
  commands?: Record<string, string>
  /** Additional glob-style filters (matched against workspace-relative paths). */
  include?: string[]
  exclude?: string[]
}

const PLUGIN_NAME = '@nx-devkit/diagrams'

/** Extension (with dot) → Kroki diagram type. */
export const DIAGRAM_TYPES: Record<string, string> = {
  '.puml': 'plantuml',
  '.plantuml': 'plantuml',
  '.mmd': 'mermaid',
  '.mermaid': 'mermaid',
  '.dot': 'graphviz',
  '.gv': 'graphviz',
  '.d2': 'd2',
  '.bpmn': 'bpmn',
  '.excalidraw': 'excalidraw',
}

const DEFAULT_GLOB = `**/*{${Object.keys(DIAGRAM_TYPES).join(',')}}`

export function diagramTypeFor(file: string): string | undefined {
  const lower = file.toLowerCase()
  const ext = Object.keys(DIAGRAM_TYPES).find((e) => lower.endsWith(e))
  // eslint-disable-next-line security/detect-object-injection -- ext comes from Object.keys(DIAGRAM_TYPES), a fixed registry
  return ext ? DIAGRAM_TYPES[ext] : undefined
}

export function slugify(relPath: string): string {
  const noExt = relPath.replace(/\.[a-z0-9]+$/i, '')
  return noExt
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-')
    .toLowerCase()
}

export function outputPathFor(
  file: string,
  projectRoot: string,
  outputDir: string | undefined,
  format: string,
): string {
  // All tokens are workspace-relative: {fileDir} is the source file's directory,
  // {projectRoot} the owning project root ('' for the root project).
  const fileDir = dirname(file)
  const fileName = (file.split('/').pop() ?? file).replace(/\.[a-z0-9]+$/i, '')
  const dir = (outputDir ?? '{fileDir}')
    .replaceAll('{fileDir}', fileDir === '.' ? '' : fileDir)
    .replaceAll('{fileName}', fileName)
    .replaceAll('{projectRoot}', projectRoot === '.' ? '' : projectRoot)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  if (isAbsolute(dir) || normalize(dir).split('/').includes('..')) {
    throw new Error(`outputDir "${outputDir}" must resolve to a directory inside the workspace`)
  }
  return [dir, `${fileName}.${format}`].filter(Boolean).join('/')
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 6)
}

/** Inserts a suffix before the extension: 'a/b.svg' + '-mermaid' → 'a/b-mermaid.svg'. */
function suffixOutput(output: string, suffix: string): string {
  return output.replace(/(\.[a-z0-9]+)$/i, `${suffix}$1`)
}

function findProjectRoot(workspaceRoot: string, fileDir: string): string {
  let dir = fileDir === '.' ? workspaceRoot : join(workspaceRoot, fileDir)
  while (dir.startsWith(workspaceRoot)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- marker filenames joined to a dir under the trusted workspace root
    if (existsSync(join(dir, 'project.json')) || existsSync(join(dir, 'package.json'))) {
      const rel = relative(workspaceRoot, dir).replace(/\\/g, '/')
      return rel === '' ? '.' : rel
    }
    dir = dirname(dir)
  }
  return '.'
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^$()|[\]\\]/g, String.raw`\$&`)
    .replace(/\?/g, '[^/]')
    .replace(/\*\*\//g, '__GLOBSTAR_SLASH__')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR_SLASH__/g, '(?:.*/)?')
    .replace(/\{([^}]*)\}/g, (_, alts: string) => `(?:${alts.split(',').join('|')})`)
  // eslint-disable-next-line security/detect-non-literal-regexp, security/detect-non-literal-reg-expr -- user-supplied glob escaped before construction
  // Nosemgrep: javascript_dos_rule-non-literal-regexp
  return new RegExp(`^${escaped}$`)
}

export const createNodesV2: CreateNodesV2<NxDiagramsPluginOptions> = [
  DEFAULT_GLOB,
  (configFiles, options = {}, context) => {
    const format = options.format ?? 'svg'
    const aggregateName = options.targetName ?? 'diagrams'
    const include = (options.include ?? []).map(globToRegExp)
    const exclude = (options.exclude ?? []).map(globToRegExp)

    const sharedOptions = {
      commands: options.commands ?? {},
      format,
      krokiUrl: options.krokiUrl ?? 'https://kroki.io',
      outputDir: options.outputDir ?? '{fileDir}',
    }

    interface DiagramFile {
      file: string
      output: string
      slug: string
      type: string
    }
    const perProject = new Map<string, DiagramFile[]>()

    for (const configFile of configFiles) {
      const file = configFile.replace(/\\/g, '/')
      const type = diagramTypeFor(file)
      if (!type) {
        continue
      }
      if (include.length > 0 && !include.some((re) => re.test(file))) {
        continue
      }
      if (exclude.some((re) => re.test(file))) {
        continue
      }

      const projectRoot = findProjectRoot(context.workspaceRoot, dirname(file))
      const rel = projectRoot === '.' ? file : relative(projectRoot, file).replace(/\\/g, '/')
      const entries = perProject.get(projectRoot) ?? []
      entries.push({
        file,
        output: outputPathFor(file, projectRoot, options.outputDir, format),
        slug: slugify(rel),
        type,
      })
      perProject.set(projectRoot, entries)
    }

    const results: (readonly [string, { projects: Record<string, ProjectConfiguration> }])[] = []
    for (const [projectRoot, entries] of perProject) {
      entries.sort((a, b) => a.file.localeCompare(b.file))

      // Files whose slugs or outputs collide get deterministic type/hash suffixes.
      const slugDup = new Set(
        entries.map((e) => e.slug).filter((s, i, all) => all.indexOf(s) !== i),
      )
      const outputDup = new Set(
        entries.map((e) => e.output).filter((o, i, all) => all.indexOf(o) !== i),
      )
      const takenNames = new Set<string>()
      const takenOutputs = new Set<string>()

      const targets: Record<string, TargetConfiguration> = {}
      for (const e of entries) {
        let name = `diagram-${e.slug}`
        if (slugDup.has(e.slug)) {
          name = `${name}-${e.type}`
        }
        if (takenNames.has(name)) {
          name = `${name}-h${shortHash(e.file)}`
        }
        takenNames.add(name)

        let output = e.output
        if (outputDup.has(output)) {
          output = suffixOutput(output, `-${e.type}`)
        }
        if (takenOutputs.has(output)) {
          output = suffixOutput(e.output, `-${e.type}-h${shortHash(e.file)}`)
        }
        takenOutputs.add(output)

        targets[name] = {
          cache: true,
          executor: `${PLUGIN_NAME}:render`,
          inputs: [`{workspaceRoot}/${e.file}`],
          outputs: [`{workspaceRoot}/${output}`],
          options: { ...sharedOptions, file: e.file, output },
        }
      }

      if (targets[aggregateName]) {
        throw new Error(
          `targetName "${aggregateName}" collides with an inferred per-file target in ${projectRoot} — pick a different targetName`,
        )
      }

      const files = entries.map((e) => e.file)
      targets[aggregateName] = {
        cache: true,
        executor: `${PLUGIN_NAME}:render`,
        inputs: files.map((f) => `{workspaceRoot}/${f}`),
        outputs: [...takenOutputs].map((o) => `{workspaceRoot}/${o}`),
        options: { ...sharedOptions, files, outputs: [...takenOutputs] },
      }

      const first = entries[0]
      if (!first) {
        continue
      }
      results.push([
        first.file,
        {
          projects: {
            [projectRoot]: { root: projectRoot, targets },
          },
        },
      ])
    }
    return results
  },
]

const plugin = { createNodesV2, name: PLUGIN_NAME }
export default plugin
