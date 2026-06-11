import { StepDefinition } from '../types'

/**
 * Opening questions of `sf new`: project identity, repository layout,
 * database setup and email service choice.
 */
export const projectStep: StepDefinition = {
  id: 'project',
  title: 'Project basics',
  fields: [
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
      type: 'input',
      name: 'projectDescription',
      message: 'What is the description of your project?',
      default: (current: { projectName?: string }) => `${current.projectName} is just an amazing SaaSFoundry project`
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
    },
    {
      type: 'list',
      name: 'isMonorepo',
      message: 'How would you like to structure your project?',
      choices: [
        { name: 'Monorepo: Single Git repository with Turborepo (centralized management, shared tooling)', value: true },
        { name: 'Multirepo: Separate Git repositories for Backend and Frontend (independent management)', value: false }
      ],
      default: true
    },
    {
      type: 'list',
      name: 'setupRepo',
      message: 'Do you have already a remote repository?',
      choices: [
        { name: 'Not yet, just setup on local', value: 'local' },
        { name: "Yes, I'll give you the link", value: 'existing' }
      ],
      when: (current) => Boolean(current.isMonorepo)
    },
    {
      type: 'list',
      name: 'setupRepo',
      message: 'Do you have already remote repositories?',
      choices: [
        { name: 'Not yet, just setup on local for both', value: 'local' },
        { name: "Yes, I'll give you the links", value: 'existing' }
      ],
      when: (current) => !current.isMonorepo
    },
    {
      type: 'input',
      name: 'monorepoUrl',
      message: 'Enter your existing monorepo Git URL',
      when: (current) => Boolean(current.isMonorepo) && current.setupRepo === 'existing',
      validate: (input: string) => {
        if (!input) return 'Git URL is required'
        return true
      }
    },
    {
      type: 'input',
      name: 'backendRepoUrl',
      message: 'Enter your existing backend Git URL',
      when: (current) => !current.isMonorepo && current.setupRepo === 'existing',
      validate: (input: string) => {
        if (!input) return 'Backend Git URL is required'
        return true
      },
      default: 'https://github.com/agachet/saasfoundry'
    },
    {
      type: 'input',
      name: 'frontendRepoUrl',
      message: 'Enter your existing frontend Git URL',
      when: (current) => !current.isMonorepo && current.setupRepo === 'existing',
      validate: (input: string) => {
        if (!input) return 'Frontend Git URL is required'
        return true
      },
      default: 'https://github.com/agachet/saasfoundry'
    },
    {
      type: 'list',
      name: 'dbSetup',
      message: 'Do you want to set up a development database with Docker? (you must have docker installed)',
      choices: [
        {
          name: 'Yes, with Docker (adds PostgreSQL to docker-compose.dev-services.yml)',
          value: 'docker'
        },
        {
          name: 'No, connect the API to my existing database',
          value: 'credentials'
        },
        { name: "No, I'll do it later", value: 'manual' }
      ]
    },
    {
      type: 'list',
      name: 'dbCredentials.dbType',
      message: 'Which database technology are you using?',
      choices: [
        { name: 'PostgreSQL', value: 'postgresql' },
        { name: 'SQL Server', value: 'sql' }
      ],
      when: (current) => current.dbSetup === 'credentials',
      default: 'postgresql'
    },
    {
      type: 'input',
      name: 'dbCredentials.host',
      message: 'Database host',
      when: (current) => current.dbSetup === 'credentials'
    },
    {
      type: 'input',
      name: 'dbCredentials.port',
      message: 'Database port',
      when: (current) => current.dbSetup === 'credentials'
    },
    {
      type: 'input',
      name: 'dbCredentials.user',
      message: 'Database user',
      when: (current) => current.dbSetup === 'docker' || current.dbSetup === 'credentials',
      default: 'db_dev_user'
    },
    {
      type: 'input',
      name: 'dbCredentials.password',
      message: 'Database password',
      when: (current) => current.dbSetup === 'docker' || current.dbSetup === 'credentials',
      default: 'db_dev_password'
    },
    {
      type: 'input',
      name: 'dbCredentials.database',
      message: 'Database name',
      when: (current) => current.dbSetup === 'docker' || current.dbSetup === 'credentials',
      default: 'db_dev'
    },
    {
      type: 'list',
      name: 'emailService',
      message: 'For your transactional emails (account creation, password reset, etc.), which service would you like to set up?',
      choices: [
        { name: 'None, just set up the logic', value: 'none' },
        { name: 'MailerSend [free, 3000 emails/month]', value: 'mailersend' }
      ],
      default: 'mailersend'
    }
  ]
}
