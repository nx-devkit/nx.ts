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
