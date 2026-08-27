import chalk from 'chalk'

import { FieldDefinition, StepDefinition } from '../types'
import { runBestEffort } from '../../run'

/**
 * MailerSend credential collection — runs only when the user picked
 * MailerSend in the project step. In interactive mode without prefilled
 * credentials, walks the user through account creation first.
 */
const mailersendFields = (projectName: string): FieldDefinition[] => [
  {
    type: 'input',
    name: 'mailersendApiKey',
    message: 'Enter your MailerSend API key',
    validate: (input: string) => {
      if (!input) return 'API key is required'
      return true
    }
  },
  {
    type: 'input',
    name: 'mailersendSenderEmail',
    message: 'Enter your MailerSend sender email',
    default: `noreply@${projectName.toLowerCase().replace(/\s+/g, '')}.com`,
    validate: (input: string) => {
      if (!input) return 'Sender email is required'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return 'Please enter a valid email address'
      return true
    }
  },
  {
    type: 'input',
    name: 'mailersendSenderName',
    message: 'Enter your MailerSend sender name',
    default: projectName.charAt(0).toUpperCase() + projectName.slice(1),
    validate: (input: string) => {
      if (!input) return 'Sender name is required'
      return true
    }
  }
]

export const emailCredentialsStep: StepDefinition = {
  id: 'email-credentials',
  title: 'MailerSend credentials',
  effects: ['Opens the MailerSend signup page in the default browser (interactive mode without prefilled credentials)'],
  appliesTo: (state) => state.emailService === 'mailersend',
  collect: async ({ state, prefill, nonInteractive, render }) => {
    const projectName = state.projectName ?? ''
    const allCredsProvided = prefill.mailersendApiKey !== undefined && prefill.mailersendSenderEmail !== undefined && prefill.mailersendSenderName !== undefined

    if (!allCredsProvided && !nonInteractive) {
      console.log(chalk.yellow('\nYou need to create an account on MailerSend to get your API key.'))
      console.log(chalk.yellow('Note: The following link is an affiliate link. We appreciate your support of the SaaSFoundryAI project by signing up through this link.'))
      console.log(chalk.yellow('Opening https://www.mailersend.com?ref=52o9lkySkTka in your browser in few seconds...'))

      // Wait a few seconds before opening the URL
      await new Promise((resolve) => setTimeout(resolve, 4000))

      // Open the URL in the default browser
      const openCommand = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      runBestEffort('open MailerSend signup', `${openCommand} https://www.mailersend.com/signup?ref=52o9lkySkTka`)

      const { ready } = (await render([
        {
          type: 'confirm',
          name: 'ready',
          message: 'Are you ready to configure your MailerSend credentials?',
          default: true
        }
      ])) as unknown as { ready?: boolean }

      if (!ready) {
        console.log(chalk.yellow('\nThe email service logic will be set up but disabled until you implement your own service.'))
        return {}
      }
    }

    return render(mailersendFields(projectName))
  }
}
