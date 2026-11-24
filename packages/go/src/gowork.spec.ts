import { describe, expect, it } from 'vitest';
import { parseGoWork } from './gowork.ts';

describe('parseGoWork', () => {
  it('parses single-line use directives', () => {
    const text = `go 1.23\n\nuse ./app\nuse ./lib\n`;
    expect(parseGoWork(text)).toEqual(['./app', './lib']);
  });

  it('parses a use block', () => {
    const text = `go 1.23\n\nuse (\n\t./app\n\t./lib\n)\n`;
    expect(parseGoWork(text)).toEqual(['./app', './lib']);
  });

  it('parses mixed single-line and block use directives', () => {
    const text = `go 1.23\n\nuse ./app\n\nuse (\n\t./lib\n)\n\nuse ./tools\n`;
    expect(parseGoWork(text)).toEqual(['./app', './lib', './tools']);
  });

  it('ignores other directives and their blocks', () => {
    const text = [
      'go 1.23',
      '',
      'toolchain go1.24',
      '',
      'use ./app',
      '',
      'replace (',
      '\texample.com/x => ../x',
      '\texample.com/y => ./y',
      ')',
      '',
      'exclude example.com/z v1.0.0',
      '',
    ].join('\n');
    expect(parseGoWork(text)).toEqual(['./app']);
  });

  it('strips // comments', () => {
    const text = `go 1.23 // workspace\n\nuse (\n\t./app // the app\n\t// ./disabled\n\t./lib\n)\n`;
    expect(parseGoWork(text)).toEqual(['./app', './lib']);
  });

  it('unquotes quoted use paths', () => {
    const text = `use "./app dir"\nuse \`./lib dir\`\n`;
    expect(parseGoWork(text)).toEqual(['./app dir', './lib dir']);
  });

  it('keeps // inside a quoted use path', () => {
    expect(parseGoWork('use "./a//b"\n')).toEqual(['./a//b']);
    expect(parseGoWork('use "./svc" // trailing comment\n')).toEqual(['./svc']);
  });

  it('unescapes Go escapes in interpreted use paths', () => {
    expect(parseGoWork('use "./foo\\x20bar"\n')).toEqual(['./foo bar']);
    expect(parseGoWork('use "./uni\\u0063ode"\n')).toEqual(['./unicode']);
  });

  it('does not unescape backtick (raw) use paths', () => {
    expect(parseGoWork('use `./foo\\x20bar`\n')).toEqual(['./foo\\x20bar']);
  });

  it('keeps malformed escapes literal', () => {
    expect(parseGoWork('use "./bad\\xZZ"\n')).toEqual(['./bad\\xZZ']);
    expect(parseGoWork('use "./bad\\qpath"\n')).toEqual(['./bad\\qpath']);
  });

  it('handles a dot use entry (the go.work dir itself)', () => {
    const text = `use (\n\t.\n\t./app\n)\n`;
    expect(parseGoWork(text)).toEqual(['.', './app']);
  });

  it('returns an empty list for a go.work without use directives', () => {
    expect(parseGoWork('go 1.23\n')).toEqual([]);
  });

  it('does not throw on garbage input', () => {
    expect(parseGoWork('{ not a go.work file !!!')).toEqual([]);
  });
});
