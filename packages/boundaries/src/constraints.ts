import type { DepConstraint } from './types.ts'

/**
 * Official-rule semantics: every constraint whose `sourceTag` matches the
 * importing project's tags must be satisfied — the target project must share
 * at least one tag with `onlyDependOnLibsWithTags`. No matching constraint →
 * allowed (permissive default).
 */
export function isAllowed(
  sourceTags: string[],
  targetTags: string[],
  constraints: DepConstraint[],
): boolean {
  return constraints
    .filter((c) => sourceTags.includes(c.sourceTag))
    .every((c) => targetTags.some((t) => c.onlyDependOnLibsWithTags.includes(t)))
}
