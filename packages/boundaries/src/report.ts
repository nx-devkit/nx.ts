import type { ReportFormat } from './types.ts';

export type ViolationKind = 'constraint' | 'external' | 'circular';

export interface BoundaryViolation {
  kind: ViolationKind;
  /** Workspace-relative file (absent for graph-level violations like cycles). */
  file?: string;
  line?: number;
  /** Importing project (or first project on a cycle path). */
  source: string;
  sourceTags?: string[];
  /** Imported project / external package (last hop on a cycle path). */
  target: string;
  targetTags?: string[];
  /** The import specifier that produced the edge. */
  specifier?: string;
  /** Closed walk of a circular violation — every hop, start repeated at the end. */
  path?: string[];
  message: string;
  /** Actionable fix hint printed under the violation. */
  hint: string;
}

function textLine(v: BoundaryViolation): string {
  const loc = v.file !== undefined ? `${v.file}:${v.line ?? 0} — ` : '';
  return `${loc}${v.message}`;
}

/** Text report lines (already indented) — violation plus its fix hint. */
export function renderTextLines(violations: BoundaryViolation[]): string[] {
  const lines: string[] = [];
  for (const v of violations) {
    lines.push(`  ${textLine(v)}`);
    lines.push(`    hint: ${v.hint}`);
  }
  return lines;
}

/**
 * Mermaid `graph LR` of violated edges. Node ids are generated (`n0`, `n1`, …)
 * because real project names contain `@`/`/` — labels carry the true names.
 * Edges dedupe: one edge per (kind, source, target).
 */
export function renderMermaid(violations: BoundaryViolation[]): string {
  const ids = new Map<string, string>();
  const idFor = (name: string): string => {
    let id = ids.get(name);
    if (!id) {
      id = `n${ids.size}`;
      ids.set(name, id);
    }
    return id;
  };
  const lines = ['graph LR'];
  const seenEdges = new Set<string>();
  for (const v of violations) {
    // A circular violation carries its full closed walk — draw every hop so
    // no member or edge disappears from the diagram.
    if (v.kind === 'circular' && v.path !== undefined && v.path.length > 1) {
      for (let i = 0; i < v.path.length - 1; i++) {
        const from = v.path[i]!;
        const to = v.path[i + 1]!;
        const key = `circular\u0000${from}\u0000${to}`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        lines.push(`  ${idFor(from)} -->|circular| ${idFor(to)}`);
      }
      continue;
    }
    const key = `${v.kind}:${v.source}:${v.target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    const edge = `${idFor(v.source)} -->|${v.kind}| ${idFor(v.target)}`;
    lines.push(`  ${edge}`);
  }
  for (const [name, id] of ids) {
    lines.push(`  ${id}["${name.replaceAll('"', '#quot;')}"]`);
  }
  return lines.join('\n');
}

/** Serialize the violation report for the requested format. */
export function renderReport(violations: BoundaryViolation[], format: ReportFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify({ success: violations.length === 0, violations }, null, 2);
    case 'mermaid':
      return renderMermaid(violations);
    default:
      return renderTextLines(violations).join('\n');
  }
}
