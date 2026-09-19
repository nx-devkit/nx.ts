export interface RenderExecutorSchema {
  file?: string
  files?: string[]
  format?: 'svg' | 'png' | 'jpeg'
  krokiUrl?: string
  outputDir?: string
  commands?: Record<string, string>
  timeout?: number
  dryRun?: boolean
}
