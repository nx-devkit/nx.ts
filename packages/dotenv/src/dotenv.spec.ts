import { describe, expect, it } from 'vitest';
import { parseDotenvKeys } from './dotenv.ts';

describe('parseDotenvKeys', () => {
  it('parses plain KEY=value assignments', () => {
    expect(parseDotenvKeys('FOO=bar\nBAZ=qux\n')).toEqual(['FOO', 'BAZ']);
  });

  it('parses empty values and whitespace-padded lines', () => {
    expect(parseDotenvKeys('  FOO=\n  BAR = "x" \n')).toEqual(['FOO', 'BAR']);
  });

  it('parses export-prefixed assignments', () => {
    expect(parseDotenvKeys('export FOO=bar\nexport BAR=baz')).toEqual(['FOO', 'BAR']);
  });

  it('skips comments and blank lines', () => {
    expect(parseDotenvKeys('# a comment\n\nFOO=1\n   # indented\n')).toEqual(['FOO']);
  });

  it('skips lines without an assignment', () => {
    expect(parseDotenvKeys('just words\nFOO=1\n=novalue\n')).toEqual(['FOO']);
  });

  it('allows dots and dashes in keys (dotenv alphabet) but not as first char', () => {
    expect(parseDotenvKeys('FOO.BAR=1\nBAZ-QUX=2\n-NOPE=3\n')).toEqual(['FOO.BAR', 'BAZ-QUX']);
  });

  it('dedupes repeated keys keeping first-seen order', () => {
    expect(parseDotenvKeys('FOO=1\nBAR=2\nFOO=3\n')).toEqual(['FOO', 'BAR']);
  });

  it('does not treat lines inside a double-quoted multiline value as keys', () => {
    const text = 'CERT="-----BEGIN\nFAKE=x\n-----END"\nREAL=1\n';
    expect(parseDotenvKeys(text)).toEqual(['CERT', 'REAL']);
  });

  it('does not treat lines inside a backtick multiline value as keys', () => {
    const text = 'TPL=`line one\nFAKE=x\nline three`\nREAL=1\n';
    expect(parseDotenvKeys(text)).toEqual(['TPL', 'REAL']);
  });

  it('recovers after an unterminated quote at EOF', () => {
    expect(parseDotenvKeys('OPEN="never closed\nSTILL=inside\n')).toEqual(['OPEN']);
  });

  it('does not close a multiline value on an escaped quote', () => {
    const text = 'CERT="-----BEGIN\nescaped \\" quote\nDOTENV_FAKE=x\n-----END"\nREAL=1\n';
    expect(parseDotenvKeys(text)).toEqual(['CERT', 'REAL']);
  });

  it('opens a multiline value when the only same-line quote is escaped', () => {
    expect(parseDotenvKeys('A="x\\"\nB=1\n')).toEqual(['A']);
  });

  it('returns an empty list for empty input', () => {
    expect(parseDotenvKeys('')).toEqual([]);
  });
});
