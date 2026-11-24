import { describe, expect, it } from 'vitest';
import { renderMermaid, renderReport, type BoundaryViolation } from './report.ts';

const violations: BoundaryViolation[] = [
  {
    kind: 'constraint',
    file: 'libs/feature/src/index.ts',
    line: 3,
    source: '@acme/feature',
    sourceTags: ['type:feature'],
    target: '@acme/app',
    targetTags: ['type:app'],
    specifier: '@acme/app',
    message: '@acme/feature (type:feature) cannot depend on @acme/app (type:app) via "@acme/app"',
    hint: 'remove the import or relax the constraint',
  },
  {
    kind: 'circular',
    source: 'a',
    target: 'b',
    message: 'circular dependency: a -> b -> a',
    hint: 'break the cycle',
  },
];

describe('renderReport json', () => {
  it('emits machine-readable violations', () => {
    const out = renderReport(violations, 'json');
    const parsed = JSON.parse(out) as { success: boolean; violations: BoundaryViolation[] };
    expect(parsed.success).toBe(false);
    expect(parsed.violations).toHaveLength(2);
    expect(parsed.violations[0]).toMatchObject({
      kind: 'constraint',
      file: 'libs/feature/src/index.ts',
      line: 3,
      source: '@acme/feature',
      target: '@acme/app',
      specifier: '@acme/app',
    });
  });

  it('emits success when there are no violations', () => {
    const parsed = JSON.parse(renderReport([], 'json')) as { success: boolean };
    expect(parsed.success).toBe(true);
  });
});

describe('renderMermaid', () => {
  it('emits a graph with quoted node labels and violation edges', () => {
    const out = renderMermaid(violations);
    expect(out).toContain('graph LR');
    // Mermaid ids cannot contain @ or / — nodes use generated ids + labels.
    expect(out).toContain('"@acme/feature"');
    expect(out).toContain('"@acme/app"');
    expect(out).toMatch(/-->\|constraint\|/);
    expect(out).toMatch(/-->\|circular\|/);
  });

  it('dedupes repeated edges', () => {
    const dup: BoundaryViolation = { ...violations[0]!, file: 'libs/feature/src/b.ts', line: 9 };
    const out = renderMermaid([...violations, dup]);
    const edgeLines = out.split('\n').filter((l) => l.includes('-->'));
    // 1 constraint edge (deduped) + 1 circular edge
    expect(edgeLines).toHaveLength(2);
  });
});

describe('renderReport text', () => {
  it('omits the line suffix when a violation carries no line', () => {
    const out = renderReport(
      [
        {
          kind: 'unreadable',
          file: 'libs/a/src/x.ts',
          source: 'a',
          target: '(unreadable file)',
          message: 'a: cannot read libs/a/src/x.ts: EISDIR',
          hint: 'fix file permissions',
        },
      ],
      'text',
    );
    expect(out).toContain('libs/a/src/x.ts — a: cannot read');
    expect(out).not.toContain(':0');
  });

  it('keeps file:line — message lines plus hints', () => {
    const out = renderReport(violations, 'text');
    expect(out).toContain(
      'libs/feature/src/index.ts:3 — @acme/feature (type:feature) cannot depend on @acme/app (type:app) via "@acme/app"',
    );
    expect(out).toContain('hint: remove the import or relax the constraint');
    expect(out).toContain('circular dependency: a -> b -> a');
  });
});
