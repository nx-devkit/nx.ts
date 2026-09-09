export interface NxPrepareForReleaseOptions {
  scope?: string[]
  placeholderTag?: string
  placeholderVersion?: string
  registry?: string
  dryRun?: boolean
  /** If true, run `npm trust github` for each published package (requires MFA). Default: false. */
  trust?: boolean
  /**
   * `owner/repo` slug used to build the `npm trust github` command.
   * Default: process.env.NPM_TRUST_REPO or `nx-devkit/nx.ts`.
   * Override per-workspace via `nx.json` plugin options or env to avoid
   * accidentally granting trust to the wrong repository.
   */
  trustRepo?: string
}

export interface PublishPlaceholderResult {
  published: string[]
  skipped: string[]
  trustCommands: string[]
}

export interface PublishPlaceholderContext {
  workspaceRoot: string
  options: NxPrepareForReleaseOptions
}
