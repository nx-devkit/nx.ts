export interface Skill {
  name: string
  root: string // relative to skills root, e.g. code-review/two-axis-review
  dir: string // absolute path to skill directory
  category: string[]
  description: string
  source: string
  body: string
  frontmatter: Record<string, unknown>
  links: SkillLink[]
}

export type SkillLinkType = 'macro' | 'file'

export interface SkillLink {
  text: string
  targetName: string
  raw: string
  type: SkillLinkType
}

export type PluginDependency = string | { name: string; version?: string; marketplace?: string }

export interface PluginManifest {
  name: string
  description?: string
  include: string[]
  targets: string[]
  dependencies?: PluginDependency[]
  [key: string]: unknown
}

export interface CompilerOptions {
  workspaceRoot: string
  skillsRoot: string
  pluginsRoot: string
  projectRoot: string
  target: string
  outDir: string
  /**
   * How to handle dependencies:
   * - `inline`: bundle all transitive dependency skills into the output (default)
   * - `external`: emit only the requested skills; references stay as `$skill{...}`
   */
  dependencies?: 'inline' | 'external'
  /**
   * Overrides the canonical source in the skills-sh bundle for skills owned by
   * this repo (default `theplenkov-ai/skills`). Forks/external skills keep their
   * declared `source`. The override is applied to both top-level `source` and
   * `metadata.source`.
   */
  publicSource?: string
  /**
   * Per-skill frontmatter overrides merged into each skill's frontmatter before
   * target resolvers run. Shape mirrors the canonical SKILL.md frontmatter so
   * anything from `skills.config.ts` can be injected: source, tier, triggers,
   * tags, etc. without editing SKILL.md files.
   */
  skillMetadata?: Record<string, { frontmatter?: Record<string, unknown> }>
}
