export interface DepConstraint {
  /** Tag present on the importing project for this constraint to apply. Supports `*` wildcards. */
  sourceTag: string;
  /** Tags the imported project must share at least one of. An empty array allows only untagged targets. Absent: no allowlist. */
  onlyDependOnLibsWithTags?: string[];
  /** Tags the imported project must NOT carry. Supports `*` wildcards. */
  notDependOnLibsWithTags?: string[];
  /** External (npm) packages this source may import. When present, unlisted externals are banned. Supports `*` wildcards. */
  allowedExternalDeps?: string[];
  /** External packages this source may not import. Supports `*` wildcards. */
  bannedExternalDeps?: string[];
  /** Alias of `allowedExternalDeps` matching `@nx/enforce-module-boundaries` naming. */
  allowedExternalImports?: string[];
  /** Alias of `bannedExternalDeps` matching `@nx/enforce-module-boundaries` naming. */
  bannedExternalImports?: string[];
}

export interface TagInference {
  /** Add `dir:<first-root-path-segment>` when inferring (e.g. `dir:packages`). Default: true. */
  dir?: boolean;
  /** First root path segment → additional inferred tags, merged over the default map
   *  (`apps|app → type:app`, `e2e → type:e2e`, `libs|lib|packages → type:lib`).
   *  An empty array removes a default mapping. */
  types?: Record<string, string[]>;
}

export type ReportFormat = 'text' | 'json' | 'mermaid';

export interface NxBoundariesOptions {
  depConstraints?: DepConstraint[];
  /** Inferred target name. Default: "check-boundaries". */
  targetName?: string;
  /**
   * Derive tags from the directory layout for projects without `nx.tags`
   * (`dir:<segment>` + a `type:*` tag for known layouts). Explicit `nx.tags`
   * always win. `false` disables inference; an object tunes it. Default: true.
   */
  inferTags?: boolean | TagInference;
  /** Report circular dependencies detected in the project graph. Default: true. */
  checkCircularDependencies?: boolean;
  /** Output format forwarded to the inferred targets. Default: "text". */
  format?: ReportFormat;
}
