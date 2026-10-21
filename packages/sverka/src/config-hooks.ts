/**
 * ESM resolve hook for loading a user's sverka config.
 *
 * A config file imports `@sverka/workflow` (and friends) from its own
 * location. When the project has no local `@sverka/*` packages installed,
 * normal resolution fails even though this plugin ships its own copies.
 * The hook re-resolves `@sverka/*` specifiers against this module, so the
 * bundled copies act as a fallback.
 *
 * Mirrors the sverka CLI's own config hooks (same `Symbol.for`-based
 * cross-copy construct markers make the two copies interoperable).
 */
import * as nodeModule from 'node:module'

type ResolveContext = { parentURL?: string } & Record<string, unknown>
type ResolveResult = { url: string }
type NextResolve = (
  specifier: string,
  context: ResolveContext,
) => ResolveResult | Promise<ResolveResult>

let registration: Promise<void> | undefined

/**
 * Register the `@sverka/*` resolve fallback.
 *
 * The registration happens once per process; concurrent callers (the Nx
 * daemon may load the project graph in parallel) share the same promise
 * instead of registering the hook twice.
 */
export async function registerConfigHooks(): Promise<void> {
  if (!registration) {
    registration = register().catch((error) => {
      // A failed registration must not be sticky — a later call may
      // succeed (e.g. a different Node version).
      registration = undefined
      throw error
    })
  }
  return registration
}

/** Register the resolve hook, ignoring an unavailable hook API. */
async function register(): Promise<void> {
  const registerHooks = (nodeModule as { registerHooks?: unknown }).registerHooks
  if (typeof registerHooks !== 'function') return

  try {
    registerHooks.call(nodeModule, { resolve: resolveWithFallback })
  } catch {
    // Hook registration unavailable — fall back to normal resolution.
  }
}

/**
 * Resolve `specifier` normally; on failure retry it against this module so
 * bundled `@sverka/*` packages can satisfy the import.
 */
function resolveWithFallback(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): ResolveResult | Promise<ResolveResult> {
  let result: ResolveResult | Promise<ResolveResult>
  try {
    result = nextResolve(specifier, context)
  } catch (error) {
    return fallback(specifier, context, nextResolve, error)
  }
  if (result instanceof Promise) {
    return result.catch((error) => fallback(specifier, context, nextResolve, error))
  }
  return result
}

function fallback(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
  error: unknown,
): ResolveResult | Promise<ResolveResult> {
  if (!specifier.startsWith('@sverka/')) throw error
  try {
    const result = nextResolve(specifier, { ...context, parentURL: import.meta.url })
    if (result instanceof Promise) {
      return result.catch(() => {
        throw error
      })
    }
    return result
  } catch {
    throw error
  }
}
