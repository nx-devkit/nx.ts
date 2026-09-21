export interface RenderExecutorSchema {
  block?: number
  blocks?: (number | null)[]
  file?: string
  files?: string[]
  output?: string
  outputs?: string[]
  format?: 'svg' | 'png' | 'jpeg'
  krokiUrl?: string
  outputDir?: string
  commands?: Record<string, string>
  timeout?: number
  dryRun?: boolean
}
