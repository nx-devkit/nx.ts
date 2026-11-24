/**
 * The `use` paths declared by a go.work file, in file order.
 *
 * The go.work grammar is line-based (like go.mod): `//` line comments,
 * `use <path>` single-line directives and `use ( <path>... )` blocks.
 * Other directives (`go`, `toolchain`, `replace`, `exclude`, `retract`,
 * `godebug`) are ignored — including their parenthesized blocks, so a
 * `replace ( old => new )` line is never mistaken for a use path.
 * Returned paths keep their written form (`./app`, `../shared`, `.` or
 * absolute); the caller resolves them against the go.work directory.
 */
export function parseGoWork(text: string): string[] {
  const use: string[] = [];
  let inUseBlock = false;
  let inOtherBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    // Strip // line comments — '//' inside a quoted path is literal.
    const line = stripComment(rawLine).trim();
    if (line === '') continue;

    if (inUseBlock) {
      if (line === ')') {
        inUseBlock = false;
        continue;
      }
      const path = unquote(line);
      if (path !== '') use.push(path);
      continue;
    }
    if (inOtherBlock) {
      if (line === ')') inOtherBlock = false;
      continue;
    }

    // Directive lines: `<verb> <args>` or `<verb> (` opening a block.
    const directive = /^([a-z]+)\s*(.*)$/.exec(line);
    if (directive === null) continue;
    const verb = directive[1];
    const rest = (directive[2] ?? '').trim();

    if (rest === '(') {
      if (verb === 'use') inUseBlock = true;
      else inOtherBlock = true;
      continue;
    }
    if (verb === 'use' && rest !== '') {
      const path = unquote(rest);
      if (path !== '') use.push(path);
    }
  }
  return use;
}

/**
 * Remove a `//` comment — everything from the first `//` outside a
 * quoted path onward (`use "./a//b"` keeps the literal `//`).
 */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote !== null) {
      if (char === '\\' && quote === '"') i++; // escaped char can't close
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/**
 * go.mod/go.work allow "..." and `...` quoting for paths with spaces.
 * Interpreted strings carry Go escapes (`"./foo\\x20bar"` → `./foo bar`);
 * backtick strings are raw. Malformed escapes stay literal — the parser
 * is total and never throws.
 */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]!;
    const last = value[value.length - 1]!;
    if (last === first) {
      if (first === '`') return value.slice(1, -1);
      if (first === '"') return unescapeGoString(value.slice(1, -1));
    }
  }
  return value;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\x0b',
  '\\': '\\',
  '"': '"',
};

/** Go interpreted-string escapes (`\xNN`, `\uNNNN`, `\UNNNNNNNN`, simple). */
function unescapeGoString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const char = s[i]!;
    if (char !== '\\' || i + 1 >= s.length) {
      out += char;
      continue;
    }
    const next = s[i + 1]!;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      out += simple;
      i++;
      continue;
    }
    if (next === 'x' || next === 'u' || next === 'U') {
      const digits = next === 'x' ? 2 : next === 'u' ? 4 : 8;
      const hex = s.slice(i + 2, i + 2 + digits);
      if (hex.length === digits && /^[0-9a-fA-F]+$/.test(hex)) {
        out += String.fromCodePoint(parseInt(hex, 16));
        i += 1 + digits;
        continue;
      }
    }
    // Unknown or malformed escape — keep it literal.
    out += char;
  }
  return out;
}
