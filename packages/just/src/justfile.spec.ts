import { describe, expect, it } from 'vitest';
import { parseDeps, parseJustfile } from './justfile.ts';

describe('parseJustfile', () => {
  it('parses recipe headers with params and deps', () => {
    const data = parseJustfile(`build target="release" $ci:
    cargo build --{{target}}

test-unit: build lint::check
    ./run-tests
`);
    const build = data.recipes.find((r) => r.name === 'build')!;
    expect(build.params).toEqual(['target="release"', '$ci']);
    expect(build.private).toBe(false);

    const test = data.recipes.find((r) => r.name === 'test-unit')!;
    expect(test.deps).toEqual(['build', 'lint::check']);
  });

  it('skips private recipes by name and attribute', () => {
    const data = parseJustfile(`_helper:
    echo secret

[private]
hidden:
    echo hidden

[no-cd, private]
also-hidden:
    echo x
`);
    expect(data.recipes.map((r) => r.name)).toEqual(['_helper', 'hidden', 'also-hidden']);
    expect(data.recipes.every((r) => r.private)).toBe(true);
  });

  it('handles @quiet recipes as normal recipes', () => {
    const data = parseJustfile(`@quiet arg1:
    echo {{arg1}}
`);
    const r = data.recipes[0]!;
    expect(r.name).toBe('quiet');
    expect(r.quiet).toBe(true);
    expect(r.params).toEqual(['arg1']);
  });

  it('captures doc comments', () => {
    const data = parseJustfile(`# Build the app
# for production
build:
    echo build

# unattached

other:
    echo x
`);
    expect(data.recipes.find((r) => r.name === 'build')!.doc).toBe('Build the app\nfor production');
    expect(data.recipes.find((r) => r.name === 'other')!.doc).toBe('');
  });

  it('records mod statements with path and optional flag', () => {
    const data = parseJustfile(`mod lint
mod? missing
mod tools 'tools/tools.just'
`);
    expect(data.modules).toEqual([
      { name: 'lint', path: null, optional: false },
      { name: 'missing', path: null, optional: true },
      { name: 'tools', path: 'tools/tools.just', optional: false },
    ]);
  });

  it('skips set, import, alias handled, and assignments', () => {
    const data = parseJustfile(`set dotenv-load
set shell := ["bash", "-c"]
import 'other.just'
import? 'maybe.just'
X := "1"
export Y := 'a:b'
alias b := build

build:
    echo ok
`);
    expect(data.recipes.map((r) => r.name)).toEqual(['build']);
    expect(data.aliases).toEqual([{ name: 'b', target: 'build' }]);
    expect(data.modules).toEqual([]);
  });

  it('does not treat indented body lines as headers', () => {
    const data = parseJustfile(`build:
    echo "not a recipe:"
    x: y

real:
    echo ok
`);
    expect(data.recipes.map((r) => r.name)).toEqual(['build', 'real']);
  });

  it('unwraps parenthesized dep invocations', () => {
    expect(parseDeps(` (build "x y") lint::check `)).toEqual(['build', 'lint::check']);
  });

  it('stops at && subsequent deps', () => {
    expect(parseDeps(' build lint && notify done')).toEqual(['build', 'lint']);
  });

  it('ignores non-name dep tokens', () => {
    expect(parseDeps('build foo=bar (p 1 2)')).toEqual(['build', 'p']);
  });
});
