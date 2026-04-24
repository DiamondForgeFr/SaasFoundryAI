import { Command } from 'commander'
import 'module-alias/register'
import { version } from '../package.json'
import { feedbackCommand } from './commands/feedback'
import { modulesCommand } from './commands/modules'
import { newCommand } from './commands/new'
import { skillCommand, runFullUninstall } from './commands/skill'
import { srsCommand } from './commands/srs'
import { updateCommand } from './commands/update'
import { toolsCommand } from './commands/tools'
import { statusCommand } from './commands/status'
import { workflowCommand } from './commands/workflow'
import { maybeEmitStaleSkillWarning } from './skill/warn'

void maybeEmitStaleSkillWarning(process.argv, version)

const program = new Command()

program.name('sf').description('SaaSFoundry CLI - Create and manage your SaaS projects').version(version)
program
  .command('new')
  .description('Create a new SaaSFoundry project')
  .option('--non-interactive', 'Fail if any required value is missing instead of prompting')
  // Project basics
  .option('--project-name <name>', 'Project name (kebab-case)')
  .option('--project-description <description>', 'Project description')
  .option('--structure <structure>', 'Project structure: monorepo or multirepo')
  .option('--main-branch <branch>', 'Main branch name: main or master')
  // Repository
  .option('--setup-repo <setup>', 'Repository setup: local or existing')
  .option('--monorepo-url <url>', 'Monorepo remote URL (when --structure monorepo and --setup-repo existing)')
  .option('--backend-repo-url <url>', 'Backend repository URL (when --structure multirepo and --setup-repo existing)')
  .option('--frontend-repo-url <url>', 'Frontend repository URL (when --structure multirepo and --setup-repo existing)')
  // Database
  .option('--db-setup <setup>', 'Database setup: docker, credentials, or manual')
  .option('--db-type <type>', 'Database type: postgresql or sql')
  .option('--db-host <host>', 'Database host')
  .option('--db-port <port>', 'Database port')
  .option('--db-user <user>', 'Database user')
  .option('--db-password <password>', 'Database password')
  .option('--db-name <name>', 'Database name')
  // Email
  .option('--email-service <service>', 'Email service: none or mailersend')
  .option('--mailersend-api-key <key>', 'MailerSend API key')
  .option('--mailersend-sender-email <email>', 'MailerSend sender email')
  .option('--mailersend-sender-name <name>', 'MailerSend sender name')
  // Storage
  .option('--s3-setup <setup>', 'S3 storage setup: docker, credentials, or manual')
  .option('--s3-endpoint <endpoint>', 'S3 endpoint URL')
  .option('--s3-access-key <key>', 'S3 access key')
  .option('--s3-secret-key <key>', 'S3 secret key')
  .option('--s3-bucket <bucket>', 'S3 bucket name')
  .option('--s3-region <region>', 'S3 region')
  // Analytics
  .option('--analytics', 'Include analytics module')
  .option('--no-analytics', 'Skip analytics module')
  // Advanced skills
  .option('--advanced-skills <skills>', 'Comma-separated list of advanced skills (context7,atlassian,notion,figma)')
  .option('--context7-api-key <key>', 'Context7 API key (unused — free public API)')
  .option('--atlassian-email <email>', 'Atlassian account email')
  .option('--atlassian-api-token <token>', 'Atlassian API token')
  .option('--atlassian-site <site>', 'Atlassian site name (e.g. "mycompany")')
  .option('--atlassian-cloud-id <id>', 'Atlassian Cloud ID')
  .option('--notion-api-token <token>', 'Notion API token')
  .option('--notion-api-version <version>', 'Notion API version (default: 2022-06-28)')
  .option('--figma-api-token <token>', 'Figma API token')
  // SRS bootstrap (opt-in)
  .option('--srs-enable', 'Enable SRS bootstrap (creates Notion workspace)')
  .option('--no-srs-enable', 'Skip SRS bootstrap')
  .option('--srs-backend <backend>', 'SRS backend (V1: notion)')
  .option('--srs-parent-page-input <urlOrId>', 'URL or ID of the Notion parent page that will host the SRS workspace')
  .option('--srs-ingest-enable', 'Enable ingestion of existing notes into the SRS after bootstrap')
  .option('--no-srs-ingest-enable', 'Skip existing-notes ingestion')
  .option('--srs-ingest-parent-input <urlOrId>', 'URL or ID of the Notion parent page that contains the existing notes to ingest')
  // Workflow
  .option('--workflow <config>', 'Workflow preset or "none" to skip')
  .option('--no-workflow', 'Skip workflow configuration entirely')
  // Post-setup behavior
  .option('--start-services', 'Start dev services automatically (DB + MinIO)')
  .option('--no-start-services', 'Do not start dev services after setup')
  .option('--start-apps <mode>', 'Apps to start after setup: all, backend, frontend, none')
  .action((opts) => newCommand(opts))
program
  .command('update')
  .description('Add modules to an existing SaaSFoundry project')
  .option('--non-interactive', 'Fail if any required value is missing instead of prompting')
  .option('--dry-run', 'Preview changes as JSON without writing files or running installers')
  .option('--accept-template-updates', 'Auto-apply non-conflicting template updates without prompting')
  .option('--conflict-strategy <strategy>', 'How to handle three-way merge conflicts: keep, replace, or save-new (default)')
  .option('--add-modules <modules>', 'Comma-separated list of modules to add (email, storage, analytics, srs, sf-skill-context7, sf-skill-atlassian, sf-skill-notion, sf-skill-figma)')
  .option('--mailersend-api-key <key>', 'MailerSend API key (when adding the email module)')
  .option('--mailersend-sender-email <email>', 'MailerSend sender email')
  .option('--mailersend-sender-name <name>', 'MailerSend sender name')
  .option('--s3-setup <setup>', 'S3 storage setup: docker or credentials')
  .option('--s3-endpoint <endpoint>', 'S3 endpoint URL')
  .option('--s3-access-key <key>', 'S3 access key')
  .option('--s3-secret-key <key>', 'S3 secret key')
  .option('--s3-bucket <bucket>', 'S3 bucket name')
  .option('--s3-region <region>', 'S3 region')
  .option('--context7-api-key <key>', 'Context7 API key (unused — free public API)')
  .option('--atlassian-email <email>', 'Atlassian account email')
  .option('--atlassian-api-token <token>', 'Atlassian API token')
  .option('--atlassian-site <site>', 'Atlassian site name (e.g. "mycompany")')
  .option('--atlassian-cloud-id <id>', 'Atlassian Cloud ID')
  .option('--notion-api-token <token>', 'Notion API token')
  .option('--notion-api-version <version>', 'Notion API version (default: 2022-06-28)')
  .option('--figma-api-token <token>', 'Figma API token')
  .option('--srs-backend <backend>', 'SRS backend (V1: notion)')
  .option('--srs-parent-page-input <urlOrId>', 'URL or ID of the Notion parent page that will host the SRS workspace')
  .action((opts) => updateCommand(opts))
program
  .command('modules')
  .description('Browse the SaaSFoundry module catalogue')
  .argument('[subcommand]', 'Subcommand to execute (list, info, match)')
  .argument('[args...]', 'Additional arguments for the subcommand (use --json for machine-readable output)')
  .allowUnknownOption()
  .action((subcommand, args) => modulesCommand(subcommand, ...(Array.isArray(args) ? args : [args])))
program
  .command('tools')
  .description('Manage multi-account credentials for advanced skills')
  .argument('[subcommand]', 'Subcommand to execute (list, accounts, add, use, current)')
  .argument('[args...]', 'Additional arguments for the subcommand')
  .action((subcommand, args) => toolsCommand(subcommand, ...(Array.isArray(args) ? args : [args])))
program
  .command('status')
  .description('Report project state and preconditions (manifest, workflow, SRS, git)')
  .option('--json', 'Output a machine-readable JSON report')
  .option('--claude-friendly', 'Output a markdown report tailored for Claude Code SessionStart hooks')
  .option('--no-network', 'Skip any network-dependent checks')
  .option('--check-gh', 'Probe for the GitHub CLI (gh) in PATH')
  .action((opts) => statusCommand(opts))
program
  .command('workflow')
  .description('Manage workflow configuration and AI rules')
  .argument('[subcommand]', 'Subcommand to execute (list, create, show, use, set-working-branch, set-ai-rules, etc.)')
  .argument('[args...]', 'Additional arguments for the subcommand')
  .action((subcommand, args) => workflowCommand(subcommand, ...(Array.isArray(args) ? args : [args])))
program
  .command('srs')
  .description('SRS workspace operations (validate, browse, draft, write, spawn, apply-update, eval)')
  .argument('[subcommand]', 'Subcommand to execute (validate, browse, draft, write, spawn, apply-update, eval)')
  .argument('[args...]', 'Additional arguments forwarded to the subcommand (see `sf srs help`)')
  .allowUnknownOption()
  .action((subcommand, args) => srsCommand(subcommand, ...(Array.isArray(args) ? args : [args])))
program
  .command('skill')
  .description('Manage the tool-saasfoundry Claude Code skill (install, update, uninstall)')
  .argument('[subcommand]', 'Subcommand to execute (install)')
  .argument('[args...]', 'Additional arguments for the subcommand (--project, --force, --yes)')
  .allowUnknownOption()
  .action((subcommand, args) => skillCommand(subcommand, ...(Array.isArray(args) ? args : [args])))
program
  .command('feedback')
  .description('File requests, bugs, and vote on SaaSFoundry proposals')
  .argument('[subcommand]', 'Subcommand to execute (request, bug, list, vote)')
  .argument('[args...]', 'Additional arguments for the subcommand')
  .allowUnknownOption()
  .action((subcommand, args) => feedbackCommand(subcommand, ...(Array.isArray(args) ? args : [args])))
program
  .command('uninstall')
  .description('Fully remove the SaaSFoundry skill and preferences (--all flag required)')
  .option('--all', 'Remove the skill (user + project scope) and wipe ~/.saasfoundry/')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (opts) => {
    if (!opts.all) {
      console.error("Error: 'sf uninstall' requires --all. Use 'sf skill uninstall' for per-scope removal.")
      process.exit(1)
    }
    await runFullUninstall({ yes: Boolean(opts.yes) })
  })
program.parse()

export { newCommand, updateCommand, modulesCommand, toolsCommand, workflowCommand, skillCommand, srsCommand, feedbackCommand, statusCommand }
