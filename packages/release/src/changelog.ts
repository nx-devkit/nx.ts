/**
 * Changelog rendering.
 *
 * The format is the one the repository's changelogs already use — a
 * `## <version> (<date>)` heading, the changes grouped by type under the
 * matching heading, one bullet per change, and a thank-you section listing
 * the contributors.
 */
import type { ConventionalCommit } from './version.js'

/** A change rendered into the changelog. */
export interface ChangelogChange extends ConventionalCommit {
  /** The pull request the change came from, when it came from one. */
  pullRequest?: { number: number; url: string }
}

/** A contributor listed in the thank-you section. */
export interface ChangelogAuthor {
  /** The display name. */
  name: string
  /** The GitHub handle, when it is known. */
  handle?: string
}

/** The heading per commit type — the emojis the repository's changelogs use. */
const HEADINGS: { type: string; heading: string }[] = [
  { type: 'feat', heading: '🚀 Features' },
  { type: 'fix', heading: '🩹 Fixes' },
  { type: 'perf', heading: '⚡ Performance Improvements' },
  { type: 'revert', heading: '⏪ Reverts' },
]

/** The heading for the changes that fit no other group. */
const OTHER_HEADING = '📦 Other'

/**
 * Render the changelog entry of one release.
 */
export function renderChangelog(input: {
  /** The version of the release. */
  version: string
  /** The release date — `YYYY-MM-DD`. */
  date: string
  /** The changes of the release. */
  changes: readonly ChangelogChange[]
  /** The contributors of the release. */
  authors?: readonly ChangelogAuthor[]
}): string {
  const lines: string[] = [`## ${input.version} (${input.date})`, '']

  for (const group of groupByType(input.changes)) {
    lines.push(`### ${group.heading}`, '')
    for (const change of group.changes) {
      lines.push(renderChange(change))
    }
    lines.push('')
  }

  if (input.authors && input.authors.length > 0) {
    lines.push('### ❤️ Thank You', '')
    for (const author of input.authors) {
      lines.push(author.handle ? `- ${author.name} @${author.handle}` : `- ${author.name}`)
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/** One heading of the changelog with its changes. */
interface ChangeGroup {
  heading: string
  changes: ChangelogChange[]
}

/** Group the changes by the heading their type belongs to. */
function groupByType(changes: readonly ChangelogChange[]): ChangeGroup[] {
  const groups: ChangeGroup[] = []
  for (const { type, heading } of HEADINGS) {
    const matching = changes.filter((change) => change.type === type)
    if (matching.length > 0) groups.push({ heading, changes: matching })
  }
  const other = changes.filter((change) => !HEADINGS.some((group) => group.type === change.type))
  if (other.length > 0) groups.push({ heading: OTHER_HEADING, changes: other })
  return groups
}

/**
 * A pull request link that is safe to put in Markdown.
 *
 * Only `https` URLs without spaces or parentheses are rendered — a `)` would
 * end the link early, and a `javascript:` URL would be executable in a
 * Markdown renderer that does not sanitize it.
 */
function safePullRequestUrl(url: string): string | undefined {
  return /^https:\/\/[^\s()<>]+$/.test(url) ? url : undefined
}

/** Render one change as a changelog bullet. */
function renderChange(change: ChangelogChange): string {
  const scope = change.scope ? `**${change.scope}:** ` : ''
  const url = change.pullRequest ? safePullRequestUrl(change.pullRequest.url) : undefined
  const link = url ? `([#${change.pullRequest!.number}](${url}))` : ''
  return `- ${scope}${change.description} ${link}`.trimEnd()
}
