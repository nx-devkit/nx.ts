import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

export interface NxDiagramsPluginOptions {
  /** Aggregate target name. Default: 'diagrams'. */
  targetName?: string
  /** Output image format. Default: 'svg'. */
  format?: 'svg' | 'png' | 'jpeg'
  /** Kroki base URL. Default: 'https://kroki.io'. Empty string disables Kroki. */
  krokiUrl?: string
  /**
   * Output directory template relative to the project root.
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
  const fileDirWs = dirname(file)
  // {fileDir} is the diagram's directory relative to the project root.
  const fileDir =
    projectRoot === '.' ? fileDirWs : relative(projectRoot, fileDirWs).replace(/\\/g, '/')
  const fileName = (file.split('/').pop() ?? file).replace(/\.[a-z0-9]+$/i, '')
  const dir = (outputDir ?? '{fileDir}')
    .replaceAll('{fileDir}', fileDir === '.' ? '' : fileDir)
    .replaceAll('{fileName}', fileName)
    .replaceAll('{projectRoot}', projectRoot === '.' ? '' : projectRoot)
  const rel = [dir.replace(/^\/+|\/+$/g, ''), `${fileName}.${format}`].filter(Boolean).join('/')
  return projectRoot === '.' ? rel : `${projectRoot}/${rel}`
}

function findProjectRoot(workspaceRoot: string, fileDir: string): string {
  let dir = fileDir === '.' ? workspaceRoot : join(workspaceRoot, fileDir)
  while (true) {
    if (existsSync(join(dir, 'project.json')) || existsSync(join(dir, 'package.json'))) {
      const rel = relative(workspaceRoot, dir).replace(/\\/g, '/')
      return rel === '' ? '.' : rel
    }
    if (dir === workspaceRoot) {
      return '.'
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return '.'
    }
    dir = parent
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replace(/\?/g, '[^/]')
    .replace(/\*\*\//g, '__GLOBSTAR_SLASH__')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR_SLASH__/g, '(?:.*/)?')
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

    const perProject = new Map<string, Map<string, TargetConfiguration>>()

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

      const fileDir = dirname(file)
      const projectRoot = findProjectRoot(context.workspaceRoot, fileDir)
      const rel = projectRoot === '.' ? file : relative(projectRoot, file).replace(/\\/g, '/')
      const slug = slugify(rel)
      const output = outputPathFor(file, projectRoot, options.outputDir, format)

      const targets = perProject.get(projectRoot) ?? new Map<string, TargetConfiguration>()
      targets.set(`diagram-${slug}`, {
        cache: true,
        executor: `${PLUGIN_NAME}:render`,
        inputs: [`{workspaceRoot}/${file}`],
        outputs: [`{workspaceRoot}/${output}`],
        options: { ...sharedOptions, file },
      })
      perProject.set(projectRoot, targets)
    }

    const results: (readonly [string, { projects: Record<string, ProjectConfiguration> }])[] = []
    const emittedRoots = new Set<string>()
    for (const configFile of configFiles) {
      const file = configFile.replace(/\\/g, '/')
      const projectRoot = findProjectRoot(context.workspaceRoot, dirname(file))
      const targets = perProject.get(projectRoot)
      if (!targets || emittedRoots.has(projectRoot)) {
        continue
      }
      emittedRoots.add(projectRoot)
      const files = [...targets.values()].map((t) => (t.options as { file: string }).file).sort()
      results.push([
        configFile,
        {
          projects: {
            [projectRoot]: {
              root: projectRoot,
              targets: {
                ...Object.fromEntries(targets),
                [aggregateName]: {
                  cache: true,
                  executor: `${PLUGIN_NAME}:render`,
                  inputs: files.map((f) => `{workspaceRoot}/${f}`),
                  outputs: files.map(
                    (f) =>
                      `{workspaceRoot}/${outputPathFor(f, projectRoot, options.outputDir, format)}`,
                  ),
                  options: { ...sharedOptions, files },
                },
              },
            },
          },
        },
      ])
    }
    return results
  },
]

const plugin = { createNodesV2, name: PLUGIN_NAME }
export default plugin
