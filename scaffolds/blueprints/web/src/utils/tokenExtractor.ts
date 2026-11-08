/**
 * Reads a token from a URL parameter without touching the URL.
 *
 * It has no side effect, so it is safe in a render or in a state initializer: React discards
 * and reruns a render that suspends (a translation namespace that loads late, for instance),
 * and the token must still be in the URL on the second run.
 */
export const readTokenFromUrl = (paramName: string): string | null => {
  return new URLSearchParams(window.location.search).get(paramName)
}

/**
 * Removes the query string from the address bar, so a token does not stay in the browser
 * history, in a bookmark or on a shared screen.
 *
 * It changes the history: call it from an effect or an event handler, never from a render.
 */
export const removeTokenFromUrl = (): void => {
  window.history.replaceState({}, document.title, window.location.pathname)
}

/**
 * Extracts a token from a URL parameter and cleans the URL by removing this parameter.
 *
 * It changes the history while it reads, so it does not belong in a render or in a state
 * initializer (use `readTokenFromUrl` there, and `removeTokenFromUrl` from an effect).
 */
export const extractTokenFromUrl = (paramName: string): string | null => {
  const token = readTokenFromUrl(paramName)

  if (token) {
    removeTokenFromUrl()
  }

  return token
}
