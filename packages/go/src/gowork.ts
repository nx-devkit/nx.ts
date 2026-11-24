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
    // Strip // line comments — go.work paths never contain '//'.
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

/** Remove a `//` comment — everything from the first `//` onward. */
function stripComment(line: string): string {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

/** go.mod/go.work allow "..." and `...` quoting for paths with spaces. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]!;
    const last = value[value.length - 1]!;
    if ((first === '"' || first === '`' || first === "'") && last === first) {
      return value.slice(1, -1);
    }
  }
  return value;
}
