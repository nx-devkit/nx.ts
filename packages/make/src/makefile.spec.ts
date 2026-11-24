import { describe, expect, it } from 'vitest';
import { parseMakefile } from './makefile.ts';

describe('parseMakefile', () => {
  it('parses simple rules', () => {
    const parsed = parseMakefile(`
build:
	tsc -b

test: build
	vitest run
`);

    expect([...parsed.targets.keys()]).toEqual(['build', 'test']);
    expect(parsed.targets.get('build')?.prerequisites).toEqual([]);
    expect(parsed.targets.get('test')?.prerequisites).toEqual(['build']);
  });

  it('collects .PHONY declarations even without a rule', () => {
    const parsed = parseMakefile(`
.PHONY: all clean
all: build
build:
	tsc
clean:
	rm -rf dist
`);

    expect([...parsed.targets.keys()]).toEqual(['all', 'build', 'clean']);
    expect(parsed.targets.get('all')?.phony).toBe(true);
    expect(parsed.targets.get('clean')?.phony).toBe(true);
    expect(parsed.targets.get('build')?.phony).toBe(false);
  });

  it('splits a multi-target rule into one entry per name', () => {
    const parsed = parseMakefile('a b c: dep\n');

    expect([...parsed.targets.keys()]).toEqual(['a', 'b', 'c']);
    expect(parsed.targets.get('b')?.prerequisites).toEqual(['dep']);
  });

  it('joins line continuations before parsing', () => {
    const parsed = parseMakefile('build: a \\\n  b \\\n  c\n\techo done\n');

    expect(parsed.targets.get('build')?.prerequisites).toEqual(['a', 'b', 'c']);
  });

  it('skips pattern rules', () => {
    const parsed = parseMakefile('%.o: %.c\n\tcc -c $<\nbuild:\n\techo ok\n');

    expect([...parsed.targets.keys()]).toEqual(['build']);
  });

  it('skips static pattern rules', () => {
    const parsed = parseMakefile('foo.o bar.o: %.o: %.c\n\tcc -c $<\nbuild:\n');

    expect([...parsed.targets.keys()]).toEqual(['build']);
  });

  it('skips internal targets starting with _', () => {
    const parsed = parseMakefile('_helper:\n\techo x\nbuild: _helper\n');

    expect([...parsed.targets.keys()]).toEqual(['build']);
    // _helper stays a literal prerequisite; the plugin drops it when
    // building dependsOn because it is not an emitted target.
    expect(parsed.targets.get('build')?.prerequisites).toEqual(['_helper']);
  });

  it('skips double-colon and grouped-target rules', () => {
    const parsed = parseMakefile('a::\n\techo a\nb c &: d\n\techo bc\ne:\n\techo e\n');

    expect([...parsed.targets.keys()]).toEqual(['e']);
  });

  it('skips GNU make special targets', () => {
    const parsed = parseMakefile('.SILENT:\n.DEFAULT_GOAL: all\n.EXPORT_ALL_VARIABLES:\nbuild:\n');

    expect([...parsed.targets.keys()]).toEqual(['build']);
  });

  it('does not mistake variable assignments for rules', () => {
    const parsed = parseMakefile('FOO := bar\nBAZ = qux\nCFLAGS += -O2\nbuild:\n');

    expect([...parsed.targets.keys()]).toEqual(['build']);
  });

  it('ignores comments, recipe lines, and conditionals', () => {
    const parsed = parseMakefile(`
# comment: not-a-rule
ifdef FOO
bar := 1
endif
build:
	recipe: not-a-rule
`);

    expect([...parsed.targets.keys()]).toEqual(['build']);
  });

  it('strips trailing comments from prerequisite lists', () => {
    const parsed = parseMakefile('build: a b # compile everything\n');

    expect(parsed.targets.get('build')?.prerequisites).toEqual(['a', 'b']);
  });

  it('keeps order-only prerequisites', () => {
    const parsed = parseMakefile('build: src | dirs\n');

    expect(parsed.targets.get('build')?.prerequisites).toEqual(['src', 'dirs']);
  });

  it('drops non-literal prerequisites (variables, globs, paths)', () => {
    const parsed = parseMakefile('build: $(DEPS) ${MORE} %.o dist/file.o b\n');

    expect(parsed.targets.get('build')?.prerequisites).toEqual(['b']);
  });

  it('merges prerequisites across repeated rule lines', () => {
    const parsed = parseMakefile('build: a\nbuild: b\n');

    expect(parsed.targets.get('build')?.prerequisites).toEqual(['a', 'b']);
  });

  it('handles an empty Makefile', () => {
    expect(parseMakefile('').targets.size).toBe(0);
    expect(parseMakefile('# nothing\n').targets.size).toBe(0);
  });

  it('does not treat a colon inside a trailing comment as a static pattern rule', () => {
    const parsed = parseMakefile('build: deps # see \n\tcc\n');
    expect(parsed.targets.has('build')).toBe(true);
    expect(parsed.targets.get('build')?.prerequisites).toEqual(['deps']);
  });
});
