import type { DepConstraint } from './types.ts'

/**
 * Official @nx/enforce-module-boundaries tag matching: `*` matches a project
 * carrying at least one tag (untagged projects stay unconstrained), and
 * partial globs like `scope:*` match by `*` wildcard expansion.
 */
function hasTag(tags: string[], pattern: string): boolean {
  if (pattern === '*') return tags.length > 0
  if (!pattern.includes('*')) return tags.includes(pattern)
  // Nosemgrep: javascript_dos_rule-non-literal-regexp -- pattern is workspace-authored config; every literal segment is regex-escaped and only '*' becomes .*
  const re = new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  )
  return tags.some((t) => re.test(t))
}

/**
 * Official-rule semantics: every constraint whose `sourceTag` matches the
 * importing project's tags must be satisfied — the target project must share
 * at least one tag with `onlyDependOnLibsWithTags`. An empty allowlist means
 * "may depend only on untagged projects". No matching constraint → allowed
 * (permissive default).
 */
export function isAllowed(
  sourceTags: string[],
  targetTags: string[],
  constraints: DepConstraint[],
): boolean {
  return constraints
    .filter((c) => hasTag(sourceTags, c.sourceTag))
    .every((c) =>
      c.onlyDependOnLibsWithTags.length === 0
        ? targetTags.length === 0
        : c.onlyDependOnLibsWithTags.some((t) => hasTag(targetTags, t)),
    )
}
