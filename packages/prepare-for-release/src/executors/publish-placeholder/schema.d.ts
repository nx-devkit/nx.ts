export interface NxPrepareForReleaseOptions {
  scope?: string[]
  placeholderTag?: string
  placeholderVersion?: string
  registry?: string
  dryRun?: boolean
  /**
   * `owner/repo` slug used to build the `npm trust github` command.
   * Default: process.env.NPM_TRUST_REPO or `ThePlenkov/nx.ts`.
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
