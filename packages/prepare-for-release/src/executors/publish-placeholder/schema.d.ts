export interface NxPrepareForReleaseOptions {
  scope?: string[]
  placeholderTag?: string
  placeholderVersion?: string
  registry?: string
  dryRun?: boolean
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
