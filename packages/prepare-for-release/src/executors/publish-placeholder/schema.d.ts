export interface NxPrepareForReleaseOptions {
  scope?: string[]
  placeholderTag?: string
  placeholderVersion?: string
  registry?: string
  dryRun?: boolean
  /** If true, run `npm trust github` for all packages including already-published (requires MFA). Default: false. */
  trust?: boolean
  /**
   * `owner/repo` slug used to build the `npm trust github` command.
   * Default: process.env.NPM_TRUST_REPO or process.env.GITHUB_REPOSITORY or `nx-devkit/nx.ts`.
   * Override per-workspace via `nx.json` plugin options or env to avoid
   * accidentally granting trust to the wrong repository.
   */
  trustRepo?: string
}

export interface PublishPlaceholderResult {
  success: boolean
  published: string[]
  skipped: string[]
  trustCommands: string[]
}
