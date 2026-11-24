/**
 * Minimal Makefile rule parser — just enough to infer Nx targets.
 *
 * This is NOT a GNU make evaluator: no variable expansion, no include
 * resolution, no conditional evaluation. It reads rule headers
 * (`name[, name…]: prerequisites`) and `.PHONY` declarations at column
 * zero, and deliberately skips every construct whose semantics need the
 * full make engine (pattern rules, static pattern rules, double-colon
 * rules, grouped targets, assignments — including target-specific
 * `name: VAR = v` assignments).
 */

/** One inferable Makefile goal. */
export interface MakeTarget {
  /** Rule name as written in the Makefile. */
  name: string;
  /**
   * Literal prerequisites collected across every rule line for this
   * name — name-shaped tokens only; `$(VAR)` refs and file paths never
   * land here. Prereq edges are informational: the plugin emits no
   * dependsOn because `make <goal>` already runs its own DAG.
   */
  prerequisites: string[];
  /** Declared in a `.PHONY:` line. */
  phony: boolean;
}

export interface ParsedMakefile {
  /** Inferable targets in declaration order. */
  targets: Map<string, MakeTarget>;
}

/** Names that may become `make:<name>` targets — no `%`, `/`, `$`. */
const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * A rule header: `<names> <sep> <rest>` where sep is `:` (normal), `::`
 * (double-colon), or `&:` (grouped). `%` and other non-name characters
 * in the name section make the whole regex fail — pattern rules never
 * reach the body.
 */
const RULE = /^([A-Za-z0-9_.-]+(?:[ \t]+[A-Za-z0-9_.-]+)*)[ \t]*(:{1,2}|&:)(.*)$/;

/** `.PHONY: a b c` — the standard way to declare non-file goals. */
const PHONY = /^\.PHONY[ \t]*:(.*)$/;

/**
 * GNU make's special built-in targets are all `.UPPERCASE`
 * (`.SILENT`, `.DEFAULT_GOAL`, `.SUFFIXES`, …). `.PHONY` is consumed
 * before the generic rule parse, so anything else matching this is a
 * directive, not a runnable goal.
 */
const SPECIAL_TARGET = /^\.[A-Z]/;

/**
 * `VAR <op> value` after the target colon is a target-specific variable
 * assignment (`tgt: CFLAGS += -O2`), not a prerequisite list. Optional
 * GNU make modifiers (`export`, `override`, `private`, `unexport`,
 * `undefine`) may lead it; assignment ops are `=`, `:=`, `::=`, `:::=`,
 * `+=`, `?=`, `!=`.
 */
const TARGET_ASSIGNMENT =
  /^[ \t]*(?:(?:export|unexport|override|private|undefine)[ \t]+)?[A-Za-z0-9_.%()-]+[ \t]*[:+?!]*=/;

/** Conventional helper/hook targets are private by `_` prefix. */
function isUsableName(name: string): boolean {
  return NAME.test(name) && !name.startsWith('_') && !SPECIAL_TARGET.test(name);
}

/**
 * Cut a rule tail at the first `#` (comment) or `;` (inline recipe) —
 * nothing past either is a prerequisite. Escaped \# is rare enough that
 * treating it as a comment opener stays conservative.
 */
function bodyOnly(rest: string): string {
  const cut = rest.search(/[#;]/);
  return cut === -1 ? rest : rest.slice(0, cut);
}

/** Literal prerequisite tokens — drops `|` markers and non-name refs. */
function parsePrerequisites(rest: string): string[] {
  const body = bodyOnly(rest);
  const out: string[] = [];
  for (const word of body.split(/[ \t]+/)) {
    if (word === '' || word === '|') continue;
    if (!NAME.test(word)) continue;
    out.push(word);
  }
  return out;
}

/** Recipes (tab-indented), stray continuations, comments, directives. */
function isSkippableLine(line: string): boolean {
  return line === '' || line.startsWith('\t') || line.startsWith(' ') || line.startsWith('#');
}

/** `.PHONY: a b c` — record usable names for the rule-less-goal pass. */
function collectPhony(line: string, phonyNames: Set<string>): boolean {
  const match = PHONY.exec(line);
  if (match === null) return false;
  for (const name of parsePrerequisites(match[1] ?? '')) {
    if (isUsableName(name)) phonyNames.add(name);
  }
  return true;
}

/** Merge a parsed rule's prerequisites into the target map. */
function applyRule(
  namesPart: string,
  prerequisites: string[],
  rules: Map<string, MakeTarget>,
): void {
  for (const name of namesPart.split(/[ \t]+/)) {
    if (name === '' || !isUsableName(name)) continue;
    const target = rules.get(name);
    if (target === undefined) {
      rules.set(name, { name, prerequisites: [...prerequisites], phony: false });
    } else {
      for (const prereq of prerequisites) {
        if (!target.prerequisites.includes(prereq)) target.prerequisites.push(prereq);
      }
    }
  }
}

/** `.PHONY` names without a rule are still runnable goals (FORCE idiom). */
function applyPhonyGoals(phonyNames: Set<string>, rules: Map<string, MakeTarget>): void {
  for (const name of phonyNames) {
    const target = rules.get(name);
    if (target === undefined) {
      rules.set(name, { name, prerequisites: [], phony: true });
    } else {
      target.phony = true;
    }
  }
}

export function parseMakefile(text: string): ParsedMakefile {
  // Normalize CRLF/CR before anything else so Windows-authored files
  // parse identically, then join backslash continuations so a split
  // header parses as one line.
  const lines = text.replace(/\r\n?/g, '\n').replace(/\\\n/g, ' ').split('\n');

  const rules = new Map<string, MakeTarget>();
  const phonyNames = new Set<string>();

  for (const line of lines) {
    if (isSkippableLine(line)) continue;
    if (collectPhony(line, phonyNames)) continue;

    const match = RULE.exec(line);
    if (match === null) continue;
    const separator = match[2] ?? '';
    const rest = match[3] ?? '';

    // `name::` double-colon and `names &:` grouped targets — edge cases
    // this parser does not model.
    if (separator !== ':') continue;
    // `VAR := value` is an assignment, not a rule.
    if (rest.startsWith('=')) continue;
    // Cut at `#`/`;` first: a `:` inside a comment or inline recipe
    // (`build: dep ; echo a:b`) must not trigger the checks below.
    const restBody = bodyOnly(rest);
    // `name: VAR = v` — a target-specific assignment carries no prereqs.
    if (TARGET_ASSIGNMENT.test(restBody)) continue;
    // `targets: pattern: prereqs` — a static pattern rule. The middle
    // section holds the target pattern, so `%` or `$(…)` there is the
    // unambiguous shape; a bare `:`-bearing prereq (`install: C:\x`)
    // is a non-name token dropped by parsePrerequisites instead.
    const secondColon = restBody.indexOf(':');
    if (secondColon !== -1 && /[%$]/.test(restBody.slice(0, secondColon))) continue;

    applyRule(match[1] ?? '', parsePrerequisites(restBody), rules);
  }

  applyPhonyGoals(phonyNames, rules);

  return { targets: rules };
}
