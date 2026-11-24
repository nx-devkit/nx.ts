/**
 * Minimal dotenv key extractor — enough to know which vars a file
 * *declares*, never what they are worth. Values are never returned.
 *
 * Supported syntax: `KEY=value`, `KEY=`, `export KEY=value`, `#`
 * comments, blank lines, whitespace padding, and keys in the dotenv
 * alphabet (`[A-Za-z_][A-Za-z0-9_.-]*`). Quoted values that open a
 * `"`, `'` or `` ` `` and do not close it on the same line are treated
 * as multiline, so continuation lines cannot masquerade as keys.
 * Escaped quotes (e.g. `\"`) never open or close a multiline value.
 */

const ASSIGNMENT_RE = /^(?:export\s+)?([A-Za-z_][\w.-]*)\s*=(.*)$/;
const QUOTE_CHARS = new Set(['"', "'", '`']);

/**
 * True when `ch` occurs in `s` without being escaped — i.e. preceded
 * by an even number of consecutive backslashes.
 */
function hasUnescapedChar(s: string, ch: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ch) continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) backslashes++;
    if (backslashes % 2 === 0) return true;
  }
  return false;
}

export function parseDotenvKeys(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  // Quote char of an unterminated multiline value, null when outside one.
  let openQuote: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (openQuote !== null) {
      // Inside a multiline quoted value — the first line carrying an
      // unescaped copy of the quote char closes it; everything else
      // (escaped quotes included) is value text.
      if (hasUnescapedChar(line, openQuote)) openQuote = null;
      continue;
    }
    if (line === '' || line.startsWith('#')) continue;

    const match = ASSIGNMENT_RE.exec(line);
    if (match === null) continue;

    const key = match[1]!;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }

    const value = match[2]!.trimStart();
    const first = value[0];
    if (first !== undefined && QUOTE_CHARS.has(first) && !hasUnescapedChar(value.slice(1), first)) {
      openQuote = first;
    }
  }

  return keys;
}
