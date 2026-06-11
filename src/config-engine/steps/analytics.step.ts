import { StepDefinition } from '../types'

/** Anonymous-analytics (Umami) opt-in. */
export const analyticsStep: StepDefinition = {
  id: 'analytics',
  title: 'Analytics',
  fields: [
    {
      type: 'confirm',
      name: 'includeAnalytics',
      message: 'Would you like to include anonymous user analytics (Umami)? (privacy-friendly, self-hosted)',
      default: true
    }
  ]
}
