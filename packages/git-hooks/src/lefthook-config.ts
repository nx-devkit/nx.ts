import { parse } from 'yaml';

/**
 * Top-level lefthook.yml keys that are settings, not git-hook sections
 * (mirrors the non-hook properties of https://lefthook.dev/schema.json).
 * Every other top-level mapping is a hook — lefthook accepts all git hook
 * names plus user-defined sections runnable via `lefthook run <name>`.
 */
const LEFTHOOK_SETTING_KEYS = new Set([
  'ai',
  'assert_lefthook_installed',
  'colors',
  'execution',
  'extends',
  'glob_matcher',
  'install_non_git_hooks',
  'lefthook',
  'min_version',
  'no_auto_install',
  'no_tty',
  'output',
  'rc',
  'remote',
  'remotes',
  'skip_lfs',
  'skip_output',
  'source_dir',
  'source_dir_local',
  'templates',
]);

/**
 * A hook name becomes a shell word in `npx lefthook run <name>` — restrict
 * it to a safe charset so a hostile or accidental config key can never
 * inject into the command.
 */
const HOOK_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export interface LefthookConfig {
  /** Sorted hook section names runnable via `lefthook run <name>`. */
  hooks: string[];
  /**
   * Top-level keys that look like hook sections but were rejected — wrong
   * value shape or an unsafe name. Callers surface these as warnings.
   */
  skipped: string[];
}

/**
 * Extract runnable hook names from a lefthook config document.
 *
 * A hook section is a top-level key whose value is a mapping (`commands:`,
 * `jobs:`, …) and which is not a known lefthook setting. Throws when the
 * YAML does not parse — the caller decides whether to warn and skip.
 */
export function parseLefthookConfig(text: string): LefthookConfig {
  const doc: unknown = parse(text);
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { hooks: [], skipped: [] };
  }

  const hooks: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(doc)) {
    if (LEFTHOOK_SETTING_KEYS.has(key)) continue;
    const isSection = typeof value === 'object' && value !== null && !Array.isArray(value);
    if (!isSection || !HOOK_NAME_PATTERN.test(key)) {
      skipped.push(key);
      continue;
    }
    hooks.push(key);
  }
  return { hooks: hooks.sort((a, b) => a.localeCompare(b)), skipped: skipped.sort() };
}
