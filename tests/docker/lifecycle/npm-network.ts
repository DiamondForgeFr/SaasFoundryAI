/**
 * The registry resets connections now and then. Twice on 2026-10-04 and once on 2026-10-09 the
 * lifecycle lane failed on `npm error code ECONNRESET … network aborted`, each time green on a
 * rerun alone, with nothing under test touching the dependencies (#908).
 *
 * npm already retries a fetch; these settings give it more attempts and room, and bound a single
 * request so a dead socket is retried instead of held for npm's default five minutes. The lifecycle
 * passes only an allowlisted environment to its processes, so every npm call site spreads them.
 * The installs `sf new` and `sf update` run inside the CLI get the same values from the lane's npm
 * wrapper, first on the container's PATH (`npm-lane/npm-lane.cjs`, #1198): a unit test keeps the
 * two equal.
 */
export const NPM_NETWORK_RETRY_ENV: Readonly<NodeJS.ProcessEnv> = {
  npm_config_fetch_retries: '5',
  npm_config_fetch_retry_mintimeout: '10000',
  npm_config_fetch_retry_maxtimeout: '60000',
  npm_config_fetch_timeout: '120000',
  npm_config_update_notifier: 'false'
}

const TRANSIENT_NETWORK_ERROR = /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b|network aborted/

/** npm's own report of a registry error; a product's ETIMEDOUT (a readiness probe, say) is not one. */
const NPM_REGISTRY_ERROR = /npm (?:error|ERR!) (?:code (?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED)\b|network )/

/** Written by the lane's npm wrapper when it stops a stalled install or cannot start npm. */
export const NPM_ENVIRONMENT_FAILURE_MARKER = 'npm-lane: environment failure'

/** A failure whose message names a transient network error, and nothing else. */
export function isTransientNpmNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return TRANSIENT_NETWORK_ERROR.test(message)
}

/**
 * A failure the lane's environment caused, not the product: a registry error npm and the wrapper
 * gave up retrying, or an install the wrapper stopped after its budget. The lane reports it apart
 * so a red run is not read as a defect in the change under test (#1198).
 */
export function isNpmEnvironmentFailure(detail: string): boolean {
  return detail.includes(NPM_ENVIRONMENT_FAILURE_MARKER) || NPM_REGISTRY_ERROR.test(detail)
}

/**
 * Runs an npm command again when its whole run still failed on a transient network error.
 * Any other failure is thrown at once, with its output.
 */
export async function withNpmNetworkRetry<T>(attempt: () => Promise<T>, attempts = 3, onRetry: (error: unknown, next: number) => void = () => {}): Promise<T> {
  for (let tried = 1; ; tried++) {
    try {
      return await attempt()
    } catch (error) {
      if (tried >= attempts || !isTransientNpmNetworkError(error)) throw error
      onRetry(error, tried + 1)
    }
  }
}
