/**
 * A line-wise justfile parser. Only column-0 lines are examined — every
 * indented line is recipe body and skipped. The grammar handled here
 * covers what target inference needs: recipe headers, prior deps,
 * `mod`/`mod?`, `alias`, attributes, doc comments. `import` and `set`
 * lines are consumed but not followed.
 */

export interface JustParam {
  /** Raw parameter text, e.g. `target="release"`, `$ci`, `+args`. */
  raw: string;
}

export interface JustRecipe {
  /** Recipe name without any leading `@` quiet marker. */
  name: string;
  /** Parameter descriptors in declaration order. */
  params: string[];
  /** Prior dependency names — `dep` or `mod::dep`. `&&` subsequent deps excluded. */
  deps: string[];
  /** Doc-comment text (`#` lines above the recipe), '' when absent. */
  doc: string;
  /** Quiet recipe (`@name:`) — still a valid target. */
  quiet: boolean;
  /** `_name` convention or `[private]` attribute — not listed by just. */
  private: boolean;
}

export interface JustModule {
  name: string;
  /** Explicit `mod name 'path'` argument, or null for the default search. */
  path: string | null;
  /** `mod?` — a missing source file is fine. */
  optional: boolean;
}

export interface JustAlias {
  name: string;
  target: string;
}

export interface JustfileData {
  recipes: JustRecipe[];
  modules: JustModule[];
  aliases: JustAlias[];
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*/;
const ASSIGN_RE =
  /^(?:export|unexport)\s+[A-Za-z_][A-Za-z0-9_-]*(\s*:=|\s*$)|^[A-Za-z_][A-Za-z0-9_-]*\s*:=/;
const MOD_RE = /^mod(\?)?\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s+(['"])([^'"]*)\3)?\s*(?:#.*)?$/;
const ALIAS_RE =
  /^alias\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:=\s*([A-Za-z_][A-Za-z0-9_-]*(?:::[A-Za-z_][A-Za-z0-9_-]*)?)/;
const DEP_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*(?:::[A-Za-z_][A-Za-z0-9_-]*)*$/;

/** Split `text` on whitespace, keeping quoted and parenthesized chunks whole. */
export function splitShellish(text: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      if (depth > 0) depth--;
      cur += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (cur !== '') {
        tokens.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur !== '') tokens.push(cur);
  return tokens;
}

/** Index of the first `:` not inside quotes/parens, or -1. */
function headerColon(line: string): number {
  let quote = '';
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      if (depth > 0) depth--;
    } else if (ch === ':' && depth === 0) {
      return i;
    }
  }
  return -1;
}

/** Prior deps from the text after `:` — stop at `&&`, unwrap `(name args)`. */
export function parseDeps(text: string): string[] {
  const deps: string[] = [];
  for (const token of splitShellish(text)) {
    if (token === '&&') break;
    let name = token;
    if (name.startsWith('(')) {
      // `(name args...)` — the recipe name is the first word inside the parens.
      name = name.replace(/^\(+/g, '').replace(/\)+$/g, '').split(/\s+/)[0] ?? '';
    } else {
      name = name.replace(/\)+$/g, '');
    }
    // Strip a trailing comment opener glued to a token.
    const hash = name.indexOf('#');
    if (hash === 0) break;
    if (hash > 0) name = name.slice(0, hash);
    if (DEP_NAME_RE.test(name)) deps.push(name);
  }
  return deps;
}

/** Parse the `[attr]` / `[attr, attr2]` / `[attr: 'x']` / `[attr('x')]` line. */
export function parseAttributeLine(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1);
  const names: string[] = [];
  for (const part of inner.split(',')) {
    const match = /^[\s]*([A-Za-z-]+)/.exec(part);
    if (match) names.push(match[1]!.toLowerCase());
  }
  return names.length > 0 ? names : null;
}

export function parseJustfile(text: string): JustfileData {
  const data: JustfileData = { recipes: [], modules: [], aliases: [] };
  let pendingAttrs: string[] = [];
  let pendingDoc: string[] = [];

  const resetPending = () => {
    pendingAttrs = [];
    pendingDoc = [];
  };

  for (const rawLine of text.split('\n')) {
    // Indented lines are recipe bodies (or continuation) — never headers.
    if (rawLine.startsWith(' ') || rawLine.startsWith('\t')) continue;

    const line = rawLine.trimEnd();
    if (line === '') {
      resetPending();
      continue;
    }
    if (line.startsWith('#')) {
      pendingDoc.push(line.replace(/^#+\s?/, ''));
      continue;
    }

    const attrs = parseAttributeLine(line);
    if (attrs !== null) {
      pendingAttrs.push(...attrs);
      continue;
    }

    // Directives and assignments end any pending attribute/doc run.
    if (/^(set|import|unalias)\b/.test(line)) {
      resetPending();
      continue;
    }

    const modMatch = MOD_RE.exec(line);
    if (modMatch !== null) {
      data.modules.push({
        name: modMatch[2]!,
        path: modMatch[4] ?? null,
        optional: modMatch[1] === '?',
      });
      resetPending();
      continue;
    }

    const aliasMatch = ALIAS_RE.exec(line);
    if (aliasMatch !== null) {
      data.aliases.push({ name: aliasMatch[1]!, target: aliasMatch[2]! });
      resetPending();
      continue;
    }

    if (ASSIGN_RE.test(line)) {
      resetPending();
      continue;
    }

    // Recipe header: [@]name [params...]: [deps...]
    const quiet = line.startsWith('@');
    const nameMatch = NAME_RE.exec(quiet ? line.slice(1) : line);
    if (nameMatch !== null) {
      const name = nameMatch[0];
      const colonIdx = headerColon(line);
      if (colonIdx > 0) {
        const paramText = line.slice((quiet ? 1 : 0) + name.length, colonIdx).trim();
        const recipe: JustRecipe = {
          name,
          params: paramText === '' ? [] : splitShellish(paramText),
          deps: parseDeps(line.slice(colonIdx + 1)),
          doc: pendingDoc.join('\n'),
          quiet,
          private: name.startsWith('_') || pendingAttrs.includes('private'),
        };
        data.recipes.push(recipe);
      }
    }
    resetPending();
  }
  return data;
}
