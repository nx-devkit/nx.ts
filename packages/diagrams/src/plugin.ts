import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, matchesGlob, relative } from 'node:path'
import { extractDiagramBlocks } from './blocks.ts'

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
  /** Report planned outputs without rendering or writing. Default: false. */
  dryRun?: boolean
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

// Each letter expands to a [lL] char class so the Nx trigger glob matches
// .PUML/.ExCaLiDrAw on case-sensitive filesystems. Char classes are used
// instead of {l,L} braces — nested braces hit the expander depth limit.
const caseGlob = (ext: string) =>
  ext.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
// .md joins the glob — fenced diagram blocks inside Markdown are extracted
// at inference time and get one atomized target per block.
const DEFAULT_GLOB = `**/*{${Object.keys(DIAGRAM_TYPES).map(caseGlob).join(',')},[mM][dD]}`

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
  nameSuffix = '',
): string {
  // All tokens are workspace-relative: {fileDir} is the source file's directory,
  // {projectRoot} the owning project root ('' for the root project).
  const fileDir = dirname(file)
  const fileName = basename(file).replace(/\.[a-z0-9]+$/i, '') + nameSuffix
  const expanded = (outputDir ?? '{fileDir}')
    .replaceAll('{fileDir}', fileDir === '.' ? '' : fileDir)
    .replaceAll('{fileName}', fileName)
    .replaceAll('{projectRoot}', projectRoot === '.' ? '' : projectRoot)
    .replace(/\\/g, '/')
  // Validate the expanded template before trimming separators so an
  // Absolute outputDir cannot slip through as a relative path.
  if (isAbsolute(expanded) || expanded.split('/').includes('..')) {
    throw new Error(`outputDir "${outputDir}" must resolve to a directory inside the workspace`)
  }
  const dir = expanded.replace(/^\/+|\/+$/g, '')
  return [dir, `${fileName}.${format}`].filter(Boolean).join('/')
}

export function shortHash(value: string): string {
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

export const createNodesV2: CreateNodesV2<NxDiagramsPluginOptions> = [
  DEFAULT_GLOB,
  (configFiles, options = {}, context) => {
    const format = options.format ?? 'svg'
    const aggregateName = options.targetName ?? 'diagrams'
    const include = options.include ?? []
    const exclude = options.exclude ?? []

    const sharedOptions = {
      commands: options.commands ?? {},
      dryRun: options.dryRun ?? false,
      format,
      krokiUrl: options.krokiUrl ?? 'https://kroki.io',
      outputDir: options.outputDir ?? '{fileDir}',
    }

    interface DiagramFile {
      /** 0-based diagram-fence index for Markdown sources. */
      block?: number
      file: string
      output: string
      slug: string
      type: string
    }
    const perProject = new Map<string, DiagramFile[]>()

    for (const configFile of configFiles) {
      const file = configFile.replace(/\\/g, '/')
      const isMd = file.toLowerCase().endsWith('.md')
      if (!isMd && !diagramTypeFor(file)) {
        continue
      }
      if (include.length > 0 && !include.some((glob) => matchesGlob(file, glob))) {
        continue
      }
      if (exclude.some((glob) => matchesGlob(file, glob))) {
        continue
      }

      const projectRoot = findProjectRoot(context.workspaceRoot, dirname(file))
      const rel = projectRoot === '.' ? file : relative(projectRoot, file).replace(/\\/g, '/')
      const baseSlug = slugify(rel)
      const entries = perProject.get(projectRoot) ?? []

      if (isMd) {
        // Block count and ordinals are declared at inference time — outputs
        // must be known statically for Nx's cache contract. The executor
        // re-extracts the block source by index when it runs.
        const abs = join(context.workspaceRoot, file)
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is a glob-matched workspace-relative path
        const blocks = extractDiagramBlocks(readFileSync(abs, 'utf8'))
        for (const block of blocks) {
          entries.push({
            block: block.index,
            file,
            output: outputPathFor(
              file,
              projectRoot,
              options.outputDir,
              format,
              `-${block.index + 1}`,
            ),
            slug: `${baseSlug}-${block.index + 1}`,
            type: block.type,
          })
        }
      } else {
        entries.push({
          file,
          output: outputPathFor(file, projectRoot, options.outputDir, format),
          slug: baseSlug,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- isMd guard above narrows to a mapped extension
          type: diagramTypeFor(file)!,
        })
      }
      if (entries.length > 0) {
        perProject.set(projectRoot, entries)
      }
    }

    // Output paths are workspace-relative, so collisions are tracked globally —
    // A shared outputDir can collide across projects. Target names are per-project.
    const outputCounts = new Map<string, number>()
    for (const entries of perProject.values()) {
      for (const e of entries) {
        outputCounts.set(e.output, (outputCounts.get(e.output) ?? 0) + 1)
      }
    }
    const takenOutputs = new Set<string>()

    const results: (readonly [string, { projects: Record<string, ProjectConfiguration> }])[] = []
    // Project roots sorted so cross-project output allocation is deterministic.
    for (const projectRoot of [...perProject.keys()].sort()) {
      const entries = perProject.get(projectRoot) ?? []
      // Byte-order + block ordinal: localeCompare can tie on canonically
      // equivalent Unicode names, which would make aggregate order depend
      // on the caller's configFiles order.
      entries.sort((a, b) =>
        a.file === b.file ? (a.block ?? -1) - (b.block ?? -1) : a.file < b.file ? -1 : 1,
      )

      // Files whose slugs or outputs collide get deterministic type/hash suffixes.
      const slugDup = new Set(
        entries.map((e) => e.slug).filter((s, i, all) => all.indexOf(s) !== i),
      )
      const takenNames = new Set<string>()
      const projectOutputs: string[] = []

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
        if ((outputCounts.get(output) ?? 0) > 1) {
          output = suffixOutput(output, `-${e.type}`)
        }
        if (takenOutputs.has(output)) {
          output = suffixOutput(e.output, `-${e.type}-h${shortHash(e.file)}`)
        }
        takenOutputs.add(output)
        projectOutputs.push(output)

        // eslint-disable-next-line security/detect-object-injection -- name is a slug derived from glob-matched workspace files
        targets[name] = {
          cache: true,
          executor: `${PLUGIN_NAME}:render`,
          inputs: [`{workspaceRoot}/${e.file}`],
          outputs: [`{workspaceRoot}/${output}`],
          options: {
            ...sharedOptions,
            file: e.file,
            output,
            ...(e.block !== undefined ? { block: e.block } : {}),
          },
        }
      }

      if (Object.hasOwn(targets, aggregateName)) {
        throw new Error(
          `targetName "${aggregateName}" collides with an inferred per-file target in ${projectRoot} — pick a different targetName`,
        )
      }

      const files = entries.map((e) => e.file)
      // eslint-disable-next-line security/detect-object-injection -- aggregateName is workspace-authored plugin config
      targets[aggregateName] = {
        cache: true,
        executor: `${PLUGIN_NAME}:render`,
        // files repeat for multi-block Markdown — dedupe for inputs only;
        // the blocks array keeps outputs↔files↔block alignment for the executor.
        inputs: [...new Set(files)].map((f) => `{workspaceRoot}/${f}`),
        outputs: projectOutputs.map((o) => `{workspaceRoot}/${o}`),
        options: {
          ...sharedOptions,
          blocks: entries.map((e) => e.block ?? null),
          files,
          outputs: projectOutputs,
        },
      }

      const first = entries.at(0)
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
