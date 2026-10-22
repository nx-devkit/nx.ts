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
  const versioned = versionedSpecifier(specifier, context)
  let result: ResolveResult | Promise<ResolveResult>
  try {
    result = nextResolve(versioned, context)
  } catch (error) {
    return fallback(versioned, context, nextResolve, error)
  }
  if (result instanceof Promise) {
    return result.catch((error) => fallback(versioned, context, nextResolve, error))
  }
  return result
}

/**
 * Carry the config fingerprint over to a relative import.
 *
 * The config module is imported with a `?v=<fingerprint>` query, so it
 * is re-evaluated when it (or one of its helpers) changes. The helpers
 * it imports have to carry the same query — otherwise the ESM cache
 * serves the old helper.
 */
function versionedSpecifier(specifier: string, context: ResolveContext): string {
  if (!specifier.startsWith('.')) return specifier
  // A CommonJS require treats the query as part of the file name — the
  // fingerprint may only ride on an ESM import.
  if (/\.(cjs|json)$/.test(specifier)) return specifier
  const parent = context.parentURL ?? ''
  const match = /[?&]v=([a-f0-9]+)/.exec(parent)
  if (!match) return specifier
  const fingerprint = match[1]!
  // Keep an existing query and the fragment.
  const [path = specifier, ...rest] = specifier.split('#')
  const fragment = rest.length > 0 ? `#${rest.join('#')}` : ''
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}v=${fingerprint}${fragment}`
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
