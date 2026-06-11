import { StepDefinition } from '../types'

/**
 * Opening question of `sf new`: what should be installed. Downstream steps
 * gate on the answer — `harness` skips every stack-related step, `stack`
 * skips the AI-harness steps (workflow, skills, SRS).
 */
export const profileStep: StepDefinition = {
  id: 'profile',
  title: 'Installation profile',
  fields: [
    {
      type: 'list',
      name: 'profile',
      message: 'What do you want to install?',
      choices: [
        { name: 'Full SaaS project: technical stack + AI workflow harness', value: 'full' },
        { name: 'AI harness only: workflow + skills + SRS on an existing project', value: 'harness' },
        { name: 'Technical stack only: no AI workflow configuration', value: 'stack' }
      ],
      default: 'full'
    }
  ]
}
