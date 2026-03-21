/**
 * Umami Analytics - Privacy-friendly, self-hosted analytics
 * @see https://umami.is/docs
 */

declare global {
  interface Window {
    umami?: {
      track: (name: string, data?: Record<string, string | number>) => void
    }
  }
}

/**
 * Initialize analytics by loading the Umami tracking script.
 * Self-gating: does nothing if VITE_ANALYTICS_URL or VITE_ANALYTICS_WEBSITE_ID is empty.
 */
export function initAnalytics(): void {
  const analyticsUrl = import.meta.env.VITE_ANALYTICS_URL
  const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID

  if (!analyticsUrl || !websiteId) return

  const script = document.createElement('script')
  script.async = true
  script.defer = true
  script.src = `${analyticsUrl}/script.js`
  script.dataset.websiteId = websiteId
  document.head.appendChild(script)
}

/**
 * Track a custom event. No-op if analytics is not initialized.
 * @param name - Event name (e.g. 'signup_click', 'feature_used')
 * @param data - Optional event properties
 */
export function trackEvent(name: string, data?: Record<string, string | number>): void {
  if (window.umami) {
    window.umami.track(name, data)
  }
}
