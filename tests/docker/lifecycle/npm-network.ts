/**
 * The registry resets connections now and then. Twice on 2026-10-04 and once on 2026-10-09 the
 * lifecycle lane failed on `npm error code ECONNRESET … network aborted`, each time green on a
 * rerun alone, with nothing under test touching the dependencies (#908).
 *
 * npm already retries a fetch; these settings give it more attempts and room. The lifecycle
 * passes only an allowlisted environment to its processes, so every npm call site spreads them.
 */
export const NPM_NETWORK_RETRY_ENV: Readonly<NodeJS.ProcessEnv> = {
  npm_config_fetch_retries: '5',
  npm_config_fetch_retry_mintimeout: '10000',
  npm_config_fetch_retry_maxtimeout: '60000'
}

const TRANSIENT_NETWORK_ERROR = /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b|network aborted/

/** A failure whose message names a transient network error, and nothing else. */
export function isTransientNpmNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return TRANSIENT_NETWORK_ERROR.test(message)
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
