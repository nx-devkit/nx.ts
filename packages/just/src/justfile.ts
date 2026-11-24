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
  /**
   * True when the dependency list is only bare `name`/`a::b` tokens — no
   * `&&`, parenthesized args, or trailing comments — so a caller can hand
   * the deps to Nx and run `just --no-deps` without dropping any.
   */
  depsArePlain: boolean;
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

/**
 * Consume one char while inside a quoted span.
 * `\` escapes the next char inside just's double-quoted strings.
 * Returns the still-open quote, or '' once the quote closes.
 */
function consumeQuoted(
  text: string,
  i: number,
  quote: string,
): { buf: string; quote: string; next: number } {
  const ch = text[i]!;
  if (quote === '"' && ch === '\\') return { buf: ch + (text[i + 1] ?? ''), quote, next: i + 1 };
  return { buf: ch, quote: ch === quote ? '' : quote, next: i };
}

/** Split `text` on whitespace, keeping quoted and parenthesized chunks whole. */
export function splitShellish(text: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      const q = consumeQuoted(text, i, quote);
      cur += q.buf;
      quote = q.quote;
      i = q.next;
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
      if (quote === '"' && ch === '\\') {
        i++; // skip the escaped char
      } else if (ch === quote) quote = '';
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
    // `&&` starts subsequent (post) deps — Nx has no post-dep concept.
    if (token.startsWith('&&')) break;
    let name = token;
    if (name.startsWith('(')) {
      // `(name args...)` — the recipe name is the first word inside the parens.
      name = name.replace(/^\(+/g, '').replace(/\)+$/g, '').split(/\s+/)[0] ?? '';
    } else {
      name = name.replace(/\)+$/g, '');
    }
    // Strip a trailing comment opener glued to a token.
    if (name.startsWith('#')) break;
    const hash = name.indexOf('#');
    if (hash > 0) name = name.slice(0, hash);
    if (DEP_NAME_RE.test(name)) deps.push(name);
  }
  return deps;
}

/** Split `a('x,y'), b` on commas outside quotes and parens. */
function splitAttrs(inner: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      cur += ch;
      if (quote === '"' && ch === '\\') {
        cur += inner[++i] ?? '';
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      if (depth > 0) depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

/** Parse the `[attr]` / `[attr, attr2]` / `[attr: 'x']` / `[attr('x')]` line. */
export function parseAttributeLine(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1);
  const names: string[] = [];
  for (const part of splitAttrs(inner)) {
    const match = /^[\s]*([A-Za-z-]+)/.exec(part);
    if (match) names.push(match[1]!.toLowerCase());
  }
  return names.length > 0 ? names : null;
}

function tryModule(line: string, data: JustfileData): boolean {
  const m = MOD_RE.exec(line);
  if (m === null) return false;
  data.modules.push({ name: m[2]!, path: m[4] ?? null, optional: m[1] === '?' });
  return true;
}

function tryAlias(line: string, data: JustfileData): boolean {
  const m = ALIAS_RE.exec(line);
  if (m === null) return false;
  data.aliases.push({ name: m[1]!, target: m[2]! });
  return true;
}

function tryRecipe(
  line: string,
  pendingAttrs: string[],
  pendingDoc: string[],
  data: JustfileData,
): void {
  // Recipe header: [@]name [params...]: [deps...]
  const quiet = line.startsWith('@');
  const nameMatch = NAME_RE.exec(quiet ? line.slice(1) : line);
  if (nameMatch === null) return;
  const name = nameMatch[0];
  const colonIdx = headerColon(line);
  if (colonIdx <= 0) return;
  const paramText = line.slice((quiet ? 1 : 0) + name.length, colonIdx).trim();
  const depText = line.slice(colonIdx + 1);
  data.recipes.push({
    name,
    params: paramText === '' ? [] : splitShellish(paramText),
    deps: parseDeps(depText),
    doc: pendingDoc.join('\n'),
    quiet,
    private: name.startsWith('_') || pendingAttrs.includes('private'),
    depsArePlain: splitShellish(depText).every((t) => DEP_NAME_RE.test(t)),
  });
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
    // A word alone is required — `set-version:` is a recipe, `import?` is
    // the optional-import form.
    if (/^(?:set|import\??|unalias)(?:\s|$)/.test(line)) {
      resetPending();
      continue;
    }
    if (tryModule(line, data) || tryAlias(line, data)) {
      resetPending();
      continue;
    }
    if (ASSIGN_RE.test(line)) {
      resetPending();
      continue;
    }

    tryRecipe(line, pendingAttrs, pendingDoc, data);
    resetPending();
  }
  return data;
}
