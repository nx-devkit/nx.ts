import type { DepConstraint } from './types.ts';

/**
 * Official @nx/enforce-module-boundaries tag matching: `*` matches a project
 * carrying at least one tag (untagged projects stay unconstrained), and
 * partial globs like `scope:*` match by `*` wildcard expansion.
 */
export function matchesTagPattern(tags: string[], pattern: string): boolean {
  if (pattern === '*') return tags.length > 0;
  if (!pattern.includes('*')) return tags.includes(pattern);
  // Nosemgrep: javascript_dos_rule-non-literal-regexp -- pattern is workspace-authored config; every literal segment is regex-escaped and only '*' becomes .*
  const re = new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  return tags.some((t) => re.test(t));
}

/** Wildcard matching for external package names (`lodash*`, `*` matches anything). */
function matchesNamePattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  return matchesTagPattern([name], pattern);
}

export type ConstraintFailReason = 'not-allowed-tag' | 'banned-tag';

export interface EdgeCheck {
  allowed: boolean;
  /** First constraint that rejected the edge. */
  constraint?: DepConstraint;
  reason?: ConstraintFailReason;
}

/**
 * Official-rule semantics: every constraint whose `sourceTag` matches the
 * importing project's tags must be satisfied.
 *
 * - `onlyDependOnLibsWithTags` present: the target must share at least one
 *   listed tag; an empty list allows only untagged targets. Absent: no
 *   allowlist — the target may carry any tags.
 * - `notDependOnLibsWithTags`: the target must not carry any listed tag.
 * - No matching constraint → allowed (permissive default).
 */
export function evaluateConstraints(
  sourceTags: string[],
  targetTags: string[],
  constraints: DepConstraint[],
): EdgeCheck {
  for (const c of constraints) {
    if (!matchesTagPattern(sourceTags, c.sourceTag)) {
      continue;
    }
    if (c.onlyDependOnLibsWithTags !== undefined) {
      const pass =
        c.onlyDependOnLibsWithTags.length === 0
          ? targetTags.length === 0
          : c.onlyDependOnLibsWithTags.some((t) => matchesTagPattern(targetTags, t));
      if (!pass) {
        return { allowed: false, constraint: c, reason: 'not-allowed-tag' };
      }
    }
    if (c.notDependOnLibsWithTags?.some((t) => matchesTagPattern(targetTags, t))) {
      return { allowed: false, constraint: c, reason: 'banned-tag' };
    }
  }
  return { allowed: true };
}

/** Back-compat wrapper: true when no matching constraint rejects the edge. */
export function isAllowed(
  sourceTags: string[],
  targetTags: string[],
  constraints: DepConstraint[],
): boolean {
  return evaluateConstraints(sourceTags, targetTags, constraints).allowed;
}

export type ExternalFailReason = 'banned-external' | 'not-allowed-external';

export interface ExternalCheck {
  allowed: boolean;
  constraint?: DepConstraint;
  reason?: ExternalFailReason;
}

/**
 * External (npm) dependency evaluation for a source project: every constraint
 * whose `sourceTag` matches must not ban the package, and a declared
 * `allowedExternalDeps`/`allowedExternalImports` allowlist must list it
 * (empty list bans everything). `*Deps` takes precedence over the nx-parity
 * `*Imports` alias.
 */
export function evaluateExternal(
  packageName: string,
  sourceTags: string[],
  constraints: DepConstraint[],
): ExternalCheck {
  for (const c of constraints) {
    if (!matchesTagPattern(sourceTags, c.sourceTag)) {
      continue;
    }
    const banned = c.bannedExternalDeps ?? c.bannedExternalImports ?? [];
    if (banned.some((p) => matchesNamePattern(packageName, p))) {
      return { allowed: false, constraint: c, reason: 'banned-external' };
    }
    const allowed = c.allowedExternalDeps ?? c.allowedExternalImports;
    if (allowed !== undefined && !allowed.some((p) => matchesNamePattern(packageName, p))) {
      return { allowed: false, constraint: c, reason: 'not-allowed-external' };
    }
  }
  return { allowed: true };
}
