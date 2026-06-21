import { type CreateNodesV2, logger, workspaceRoot } from '@nx/devkit'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function isVerbose(): boolean {
  if (process.argv.includes('--verbose')) {
    return true
  }
  if (process.env.NX_VERBOSE_LOGGING === 'true') {
    return true
  }
  try {
    const envPath = join(workspaceRoot, '.env')
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8')
      return envContent.includes('NX_VERBOSE_LOGGING=true')
    }
  } catch {
    // ignore
  }
  return false
}

function logDebug(message: string): void {
  if (isVerbose()) {
    logger.info(`[nx-devkit/tsdown] ${message}`)
  }
}

export const createNodesV2: CreateNodesV2 = [
  '**/tsdown.config.ts',
  (configFiles, _options, _context) => {
    const verbose = isVerbose()
    if (verbose) {
      logger.info(`[nx-devkit/tsdown] Processing ${configFiles.length} tsdown config files`)
    }

    return configFiles
      .filter((configFile) => {
        const dir = dirname(configFile)
        return dir !== '.' && dir !== ''
      })
      .map((configFile) => {
        const projectRoot = dirname(configFile)
        logDebug(`Found tsdown.config.ts in ${projectRoot}`)

        const buildTarget = {
          executor: 'nx:run-commands',
          options: {
            command: 'npx tsdown',
            cwd: projectRoot,
          },
          outputs: [`{projectRoot}/dist`],
          cache: true,
          inputs: [
            `{projectRoot}/src/**/*.ts`,
            `{projectRoot}/tsconfig.lib.json`,
            `{projectRoot}/tsdown.config.ts`,
            `{projectRoot}/package.json`,
          ],
          dependsOn: ['^build'],
        }

        return [
          configFile,
          {
            projects: {
              [projectRoot]: {
                targets: {
                  build: buildTarget,
                },
              },
            },
          },
        ]
      })
  },
]
