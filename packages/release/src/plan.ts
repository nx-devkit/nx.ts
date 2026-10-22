/**
 * The release plan.
 *
 * The release carries one version for the whole repository. A package
 * whose content did not change is not published — it keeps its version,
 * gets no tarball and no changelog entry.
 *
 * The plan is pure: the caller supplies the packages, the bump and the
 * set of changed packages; the plan says what to publish, what to skip
 * and what the changelogs look like.
 */
import { renderChangelog, type ChangelogAuthor, type ChangelogChange } from './changelog.js'
import { nextVersion, type ReleaseBump } from './version.js'

/** A package that can be published. */
export interface ReleasePackage {
  /** The npm package name. */
  name: string
  /** The package directory, workspace-relative. */
  path: string
  /** The version currently in the manifest. */
  version: string
}

/** What the plan needs to know. */
export interface ReleasePlanInput {
  /** Every package that can be published. */
  packages: readonly ReleasePackage[]
  /** The version the release is based on — the highest current version. */
  baseline: string
  /** The bump the commits imply. */
  bump: ReleaseBump
  /** The packages whose content changed since the last release. */
  changed: readonly string[]
  /** The changes per package, for the changelog. */
  changes?: Readonly<Record<string, readonly ChangelogChange[]>>
  /** The contributors of the release — the thank-you section lists them. */
  authors: readonly ChangelogAuthor[]
  /** The release date — `YYYY-MM-DD`. */
  date: string
}

/** What the release does. */
export interface ReleasePlan {
  /** The version of the release — every published package gets it. */
  version: string
  /** The packages to publish, with the release version. */
  publish: (ReleasePackage & { version: string })[]
  /** The packages that are not published, and why. */
  skipped: { name: string; reason: string }[]
  /** The changelog of every published package. */
  changelogs: { name: string; content: string }[]
}

/** The reason a package is not published. */
const UNCHANGED = 'unchanged since the last release'

/**
 * Plan a release.
 *
 * A package outside the changed set is skipped: its content is unchanged,
 * so a new tarball would carry the same code under a new version.
 */
export function planRelease(input: ReleasePlanInput): ReleasePlan {
  const version = nextVersion(input.baseline, input.bump)
  const changed = new Set(input.changed)

  const publish: (ReleasePackage & { version: string })[] = []
  const skipped: { name: string; reason: string }[] = []
  const changelogs: { name: string; content: string }[] = []

  for (const pkg of input.packages) {
    if (!changed.has(pkg.name)) {
      skipped.push({ name: pkg.name, reason: UNCHANGED })
      continue
    }
    publish.push({ ...pkg, version })
    changelogs.push({
      name: pkg.name,
      content: renderChangelog({
        version,
        date: input.date,
        changes: input.changes?.[pkg.name] ?? [],
        authors: input.authors,
      }),
    })
  }

  return { version, publish, skipped, changelogs }
}

/**
 * The version a release is based on.
 *
 * The highest version among the packages — the release never moves a
 * package below the version it already has.
 */
export function releaseBaseline(packages: readonly ReleasePackage[]): string {
  let highest: string | undefined
  for (const pkg of packages) {
    if (!highest || compareVersions(pkg.version, highest) > 0) {
      highest = pkg.version
    }
  }
  if (!highest) {
    throw new Error('no packages to release')
  }
  return highest
}

/**
 * Compare two semver versions.
 *
 * A pre-release suffix makes a version older than the same version
 * without one — `1.0.0-rc.1` comes before `1.0.0`.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) {
      return left[key] - right[key]
    }
  }
  return comparePreRelease(left.pre, right.pre)
}

/**
 * Compare two pre-release suffixes.
 *
 * The semver rules: a pre-release comes before the release it leads to,
 * numeric identifiers compare numerically and rank below alphanumeric
 * ones, and a shorter set of identifiers comes first.
 */
function comparePreRelease(a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) {
    if (a === b) return 0
    return a === undefined ? 1 : -1
  }
  const left = a.split('.')
  const right = b.split('.')
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index]
    const r = right[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const lNumeric = /^\d+$/.test(l)
    const rNumeric = /^\d+$/.test(r)
    if (lNumeric && rNumeric) {
      const diff = Number(l) - Number(r)
      if (diff !== 0) return diff
    } else if (lNumeric !== rNumeric) {
      return lNumeric ? -1 : 1
    } else if (l !== r) {
      return l < r ? -1 : 1
    }
  }
  return 0
}

/** A parsed version. */
interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** The pre-release suffix, without the leading dash. */
  pre?: string
}

/** The major, minor, patch and pre-release of a version. */
function parseVersion(version: string): ParsedVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  )
  if (!match) {
    throw new Error(`not a semver version: ${version}`)
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] ? { pre: match[4] } : {}),
  }
}
