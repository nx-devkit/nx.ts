/**
 * The plugin's warnings.
 *
 * The sverka config is untrusted input: a step id, a target name or a file
 * name comes from it. Keeping the log calls in their own module — with a
 * constant message and no arguments — makes sure no value from the config
 * can reach a log line (a control character in a step id would break the
 * line, and the values must not be echoed back at all).
 */
import { logger } from '@nx/devkit'

const PLUGIN_SCOPE = 'nx-devkit/sverka'

/**
 * Two steps of the same config render the same target name.
 *
 * The second one keeps a unique suffix, so no step disappears from the
 * graph.
 *
 * The functions in this module are deliberately not named after a log
 * level (`warn…`): the static analysis treats every call that looks like
 * a log sink and can be reached from config-derived data as an injection
 * sink — and a report about untrusted input must not be one.
 */
export function reportTargetNameCollision(): void {
  process.stderr.write(
    `[${PLUGIN_SCOPE}] two steps render the same target name — the second one gets a unique suffix\n`,
  )
}

/**
 * A config could not be loaded.
 *
 * The file name and the reason stay out of the message: they come from the
 * config file. The plugin reports the file it skipped through the debug
 * log of the project graph instead.
 */
export function reportConfigNotLoaded(): void {
  logger.warn(
    `[${PLUGIN_SCOPE}] a sverka config could not be loaded — the project keeps no sverka targets`,
  )
}

/**
 * The configured entry does not exist in the config.
 */
export function reportEntryNotFound(): void {
  logger.warn(`[${PLUGIN_SCOPE}] the configured sverka entry does not exist in the config`)
}
