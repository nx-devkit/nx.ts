import { describe, expect, it } from 'vitest';
import { evaluateConstraints, evaluateExternal, isAllowed } from './constraints.ts';

const constraints = [
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:feature', 'type:util'] },
  { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:feature', 'type:util'] },
];

describe('isAllowed', () => {
  it('allows imports matching onlyDependOnLibsWithTags', () => {
    expect(isAllowed(['type:app'], ['type:util'], constraints)).toBe(true);
    expect(isAllowed(['type:feature'], ['type:feature'], constraints)).toBe(true);
  });

  it('rejects imports outside the allowed set', () => {
    expect(isAllowed(['type:feature'], ['type:app'], constraints)).toBe(false);
    expect(isAllowed(['type:util'], ['type:app'], constraints)).toBe(true); // Util unconstrained
  });

  it('rejects untagged targets when a constraint applies', () => {
    expect(isAllowed(['type:app'], [], constraints)).toBe(false);
  });

  it('is permissive when no constraint matches the source tags', () => {
    expect(isAllowed(['scope:x'], ['type:app'], constraints)).toBe(true);
    expect(isAllowed([], ['type:app'], constraints)).toBe(true);
  });

  it('an empty allowlist permits only untagged targets', () => {
    const tagless = [{ sourceTag: 'type:app', onlyDependOnLibsWithTags: [] }];
    expect(isAllowed(['type:app'], [], tagless)).toBe(true);
    expect(isAllowed(['type:app'], ['type:util'], tagless)).toBe(false);
  });

  it('requires every matching constraint to pass', () => {
    const strict = [
      { sourceTag: 'a', onlyDependOnLibsWithTags: ['x'] },
      { sourceTag: 'b', onlyDependOnLibsWithTags: ['y'] },
    ];
    expect(isAllowed(['a', 'b'], ['x'], strict)).toBe(false); // 'b' constraint fails
    expect(isAllowed(['a', 'b'], ['x', 'y'], strict)).toBe(true);
  });

  it('sourceTag "*" applies to tagged sources but keeps untagged sources permissive', () => {
    const star = [{ sourceTag: '*', onlyDependOnLibsWithTags: ['type:util'] }];
    expect(isAllowed(['type:app'], ['type:util'], star)).toBe(true);
    expect(isAllowed(['type:app'], ['type:feature'], star)).toBe(false);
    expect(isAllowed([], ['type:feature'], star)).toBe(true); // untagged source: no constraint
  });

  it('onlyDependOnLibsWithTags "*" requires the target to carry at least one tag', () => {
    const star = [{ sourceTag: 'type:app', onlyDependOnLibsWithTags: ['*'] }];
    expect(isAllowed(['type:app'], ['anything'], star)).toBe(true);
    expect(isAllowed(['type:app'], [], star)).toBe(false);
  });

  it('supports partial globs like "scope:*"', () => {
    const glob = [{ sourceTag: 'scope:*', onlyDependOnLibsWithTags: ['scope:*'] }];
    expect(isAllowed(['scope:a'], ['scope:b'], glob)).toBe(true);
    expect(isAllowed(['scope:a'], ['other:b'], glob)).toBe(false);
    expect(isAllowed(['other:a'], ['scope:b'], glob)).toBe(true); // source doesn't match
  });
});

describe('notDependOnLibsWithTags', () => {
  const banned = [{ sourceTag: 'type:*', notDependOnLibsWithTags: ['type:e2e'] }];

  it('rejects a target carrying a banned tag', () => {
    expect(isAllowed(['type:app'], ['type:e2e'], banned)).toBe(false);
    expect(isAllowed(['type:app'], ['type:util'], banned)).toBe(true);
  });

  it('supports wildcards in the banned tag list', () => {
    const c = [{ sourceTag: 'type:app', notDependOnLibsWithTags: ['scope:private-*'] }];
    expect(isAllowed(['type:app'], ['scope:private-x'], c)).toBe(false);
    expect(isAllowed(['type:app'], ['scope:public'], c)).toBe(true);
  });

  it('combines with onlyDependOnLibsWithTags — both must pass', () => {
    const c = [
      {
        sourceTag: 'type:feature',
        onlyDependOnLibsWithTags: ['type:util', 'type:ui'],
        notDependOnLibsWithTags: ['scope:internal'],
      },
    ];
    expect(isAllowed(['type:feature'], ['type:util'], c)).toBe(true);
    expect(isAllowed(['type:feature'], ['type:util', 'scope:internal'], c)).toBe(false);
    expect(isAllowed(['type:feature'], ['type:app'], c)).toBe(false);
  });

  it('a ban alone is an active constraint (no allowlist needed)', () => {
    const c = [{ sourceTag: 'type:app', notDependOnLibsWithTags: ['type:e2e'] }];
    const res = evaluateConstraints(['type:app'], ['type:e2e'], c);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('banned-tag');
  });

  it('evaluateConstraints reports the failing constraint and reason', () => {
    const c = [{ sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:util'] }];
    const res = evaluateConstraints(['type:app'], ['type:app'], c);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('not-allowed-tag');
    expect(res.constraint).toBe(c[0]);
  });
});

describe('evaluateExternal', () => {
  it('is allowed when no constraint matches the source tags', () => {
    const c = [{ sourceTag: 'type:app', bannedExternalDeps: ['fs-extra'] }];
    expect(evaluateExternal('fs-extra', ['type:util'], c)).toEqual({ allowed: true });
    expect(evaluateExternal('fs-extra', [], c)).toEqual({ allowed: true });
  });

  it('bans listed external packages', () => {
    const c = [{ sourceTag: 'type:app', bannedExternalDeps: ['fs-extra', 'lodash*'] }];
    expect(evaluateExternal('fs-extra', ['type:app'], c)).toMatchObject({
      allowed: false,
      reason: 'banned-external',
    });
    expect(evaluateExternal('lodash-es', ['type:app'], c).allowed).toBe(false);
    expect(evaluateExternal('react', ['type:app'], c).allowed).toBe(true);
  });

  it('an allowlist rejects unlisted packages', () => {
    const c = [{ sourceTag: 'type:app', allowedExternalDeps: ['react', 'react-*'] }];
    expect(evaluateExternal('react', ['type:app'], c).allowed).toBe(true);
    expect(evaluateExternal('react-dom', ['type:app'], c).allowed).toBe(true);
    expect(evaluateExternal('lodash', ['type:app'], c)).toMatchObject({
      allowed: false,
      reason: 'not-allowed-external',
    });
  });

  it('an empty allowlist bans every external package', () => {
    const c = [{ sourceTag: 'type:app', allowedExternalDeps: [] }];
    expect(evaluateExternal('react', ['type:app'], c).allowed).toBe(false);
  });

  it('supports the nx-parity *Imports aliases', () => {
    const c = [
      {
        sourceTag: 'type:app',
        allowedExternalImports: ['react'],
        bannedExternalImports: ['lodash'],
      },
    ];
    expect(evaluateExternal('react', ['type:app'], c).allowed).toBe(true);
    expect(evaluateExternal('lodash', ['type:app'], c).allowed).toBe(false);
    expect(evaluateExternal('lodash', ['type:app'], c).reason).toBe('banned-external');
  });

  it('checks the scoped package name for subpath imports', () => {
    const c = [{ sourceTag: 'type:app', allowedExternalDeps: ['@angular/*'] }];
    // The executor passes the extracted package name, e.g. "@angular/core".
    expect(evaluateExternal('@angular/core', ['type:app'], c).allowed).toBe(true);
    expect(evaluateExternal('lodash', ['type:app'], c).allowed).toBe(false);
  });
});
