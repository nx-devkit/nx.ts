/**
 * A value from the config file, safe to put into a log message — the
 * config is untrusted input, and a log line must stay one line. Strips
 * C0/C1 controls, DEL, bidi, and isolate controls so terminal escape
 * sequences and forged log lines cannot pass through.
 */
export function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out +=
      code < 32 ||
      (code >= 127 && code <= 159) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
        ? ' '
        : char;
  }
  return out.trim();
}
