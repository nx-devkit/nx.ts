/**
 * Version derivation from conventional commits.
 *
 * The release carries one version for the whole repository: the commits
 * since the previous release decide the bump, and every package that is
 * published gets that version. Commits that do not imply a release
 * (docs, chore, ci, …) are ignored — a repository with nothing releasable
 * skips the release entirely.
 */

/** The semver bump a release implies. */
export type ReleaseBump = 'major' | 'minor' | 'patch'

/** A commit subject parsed as a conventional commit. */
export interface ConventionalCommit {
  /** The commit type — `feat`, `fix`, `docs`, … */
  type: string
  /** The scope, when the subject carries one. */
  scope?: string | undefined
  /** True when the commit breaks the public API. */
  breaking: boolean
  /** The subject without the type and scope prefix. */
  description: string
}

/** Commit types that release a minor version. */
const MINOR_TYPES = new Set(['feat'])

/** Commit types that release a patch version. */
const PATCH_TYPES = new Set(['fix', 'perf', 'revert'])

/** Conventional commit subject: `type(scope)!: description`. */
const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.*)$/

/**
 * Parse a commit subject as a conventional commit.
 *
 * Returns `undefined` for a subject that does not follow the convention —
 * such a commit never triggers a release.
 */
export function parseConventionalCommit(subject: string): ConventionalCommit | undefined {
  const match = CONVENTIONAL.exec(subject.trim())
  if (!match) return undefined
  const [, type, scope, breaking, description] = match
  if (!type || !description) return undefined
  return {
    type: type.toLowerCase(),
    scope: scope || undefined,
    breaking: breaking === '!',
    description: description.trim(),
  }
}

/**
 * The bump a set of commits implies.
 *
 * `undefined` when no commit implies a release.
 */
export function deriveBump(commits: readonly ConventionalCommit[]): ReleaseBump | undefined {
  let bump: ReleaseBump | undefined
  for (const commit of commits) {
    const candidate = bumpFor(commit)
    if (!candidate) continue
    if (!bump || rank(candidate) > rank(bump)) bump = candidate
  }
  return bump
}

/** The bump a single commit implies. */
function bumpFor(commit: ConventionalCommit): ReleaseBump | undefined {
  if (commit.breaking) return 'major'
  if (MINOR_TYPES.has(commit.type)) return 'minor'
  if (PATCH_TYPES.has(commit.type)) return 'patch'
  return undefined
}

/** The bump order — a major outranks a minor, a minor outranks a patch. */
function rank(bump: ReleaseBump): number {
  return bump === 'major' ? 3 : bump === 'minor' ? 2 : 1
}

/**
 * The next version for a base version and a bump.
 *
 * A major bump resets the minor and the patch, a minor bump resets the
 * patch — the usual semver rules.
 */
export function nextVersion(current: string, bump: ReleaseBump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(current.trim())
  if (!match) {
    throw new Error(`not a semver version: ${current}`)
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}
