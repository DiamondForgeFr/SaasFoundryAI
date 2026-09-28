import { StepDefinition } from '../types'

/**
 * Installable-app (PWA) opt-out.
 *
 * On by default: the common case is an app people can install. It stays a real, declinable
 * module because SaaSFoundryAI builds products for other people — some authors will not want
 * theirs installable, and that has to be a choice rather than something to strip out afterwards.
 */
export const pwaStep: StepDefinition = {
  id: 'pwa',
  title: 'Installable app',
  // A harness-only install has no web app to make installable.
  appliesTo: (state) => state.profile !== 'harness',
  fields: [
    {
      type: 'confirm',
      name: 'includePwa',
      message: 'Make the app installable as a desktop application? (adds a web manifest + service worker)',
      default: true
    }
  ]
}
