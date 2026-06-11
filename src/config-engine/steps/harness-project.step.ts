import chalk from 'chalk'

import { detectGitRepo } from '../../utils/git-info'
import { FieldDefinition, StepDefinition } from '../types'

const fallbackFields: FieldDefinition[] = [
  {
    type: 'input',
    name: 'projectName',
    message: 'What is the name of your project?',
    validate: (input: string) => {
      if (!input) return 'Project name is required'
      if (!/^[a-z0-9-]+$/.test(input)) {
        return 'Project name can only contain lowercase letters, numbers, and hyphens'
      }
      return true
    }
  },
  {
    type: 'list',
    name: 'mainBranch',
    message: 'Which main branch name do you prefer?',
    choices: [
      { name: 'main', value: 'main' },
      { name: 'master', value: 'master' }
    ],
    default: 'main'
  }
]

/**
 * Harness-profile replacement for the project step: detects the existing
 * repository (name, default branch) instead of asking. Explicit flags still
 * win over detection. Falls back to the two questions only when the current
 * directory is not a git repository (interactive mode) — and fails fast with
 * a clear message in non-interactive mode.
 */
export const harnessProjectStep: StepDefinition = {
  id: 'harness-project',
  title: 'Existing project detection',
  appliesTo: (state) => state.profile === 'harness',
  collect: async ({ prefill, nonInteractive, render }) => {
    const detected = detectGitRepo()

    if (!detected) {
      if (nonInteractive) {
        if (prefill.projectName !== undefined && prefill.mainBranch !== undefined) {
          return { projectName: prefill.projectName, mainBranch: prefill.mainBranch }
        }
        throw new Error('The harness profile requires an existing git repository (or explicit --project-name and --main-branch flags in --non-interactive mode).')
      }
      console.log(chalk.yellow('\nNo git repository detected in the current directory — please describe the project.'))
      return render(fallbackFields)
    }

    const projectName = prefill.projectName ?? detected.name
    const mainBranch = prefill.mainBranch ?? (detected.defaultBranch === 'master' ? 'master' : 'main')

    if (!nonInteractive) {
      console.log(chalk.gray(`\nDetected existing repository: ${projectName} (default branch: ${mainBranch})`))
    }

    return { projectName, mainBranch: mainBranch as 'main' | 'master' }
  },
  decisions: (collected) => [{ stepId: 'harness-project', name: 'projectName', value: collected.projectName }]
}
