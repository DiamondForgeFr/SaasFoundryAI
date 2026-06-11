import { StepDefinition } from '../types'

/** Analytics opt-in, moved verbatim from `src/prompts/project.prompts.ts`. */
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
