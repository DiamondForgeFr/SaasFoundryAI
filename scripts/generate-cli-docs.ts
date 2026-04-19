#!/usr/bin/env tsx

/**
 * Auto-generate CLI documentation from Commander command definitions
 *
 * This script extracts command information from the CLI implementation
 * and generates markdown documentation for each command.
 *
 * Usage: npm run docs:generate
 */

import { writeFile } from 'fs/promises'
import { resolve } from 'path'

interface CommandDoc {
  name: string
  description: string
  usage: string
  options: Array<{
    flags: string
    description: string
    defaultValue?: string
  }>
  examples: string[]
  notes?: string
}

function generateCommandMarkdown(cmd: CommandDoc): string {
  let md = `# ${cmd.name}\n\n`
  md += `${cmd.description}\n\n`

  md += `## Usage\n\n`
  md += `\`\`\`bash\n${cmd.usage}\n\`\`\`\n\n`

  if (cmd.options.length > 0) {
    md += `## Options\n\n`
    md += `| Flag | Description | Default |\n`
    md += `|------|-------------|----------|\n`
    for (const opt of cmd.options) {
      const flagsCell = opt.flags.replace(/\|/g, '\\|')
      const descriptionCell = opt.description.replace(/\|/g, '\\|')
      const defaultVal = opt.defaultValue ? `\`${opt.defaultValue}\`` : '-'
      md += `| \`${flagsCell}\` | ${descriptionCell} | ${defaultVal} |\n`
    }
    md += `\n`
  }

  if (cmd.examples.length > 0) {
    md += `## Examples\n\n`
    for (const example of cmd.examples) {
      md += `\`\`\`bash\n${example}\n\`\`\`\n\n`
    }
  }

  if (cmd.notes) {
    md += `## Notes\n\n${cmd.notes}\n\n`
  }

  md += `## See Also\n\n`
  md += `- [CLI Commands](/cli/sf-new)\n`
  md += `- [Getting Started](/getting-started/quick-start)\n`

  return md
}

const commands: CommandDoc[] = [
  {
    name: 'sf new',
    description: 'Create a new SaaSFoundry project with interactive prompts, or scripted scaffolding via flags.',
    usage: 'sf new [options]',
    options: [
      { flags: '--non-interactive', description: 'Fail if any required value is missing instead of prompting' },
      { flags: '--project-name <name>', description: 'Project name (kebab-case)' },
      { flags: '--project-description <description>', description: 'Project description' },
      { flags: '--structure <structure>', description: 'Project structure: `monorepo` or `multirepo`' },
      { flags: '--main-branch <branch>', description: 'Main branch name: `main` or `master`' },
      { flags: '--setup-repo <setup>', description: 'Repository setup: `local` or `existing`' },
      { flags: '--monorepo-url <url>', description: 'Monorepo remote URL (monorepo + existing)' },
      { flags: '--backend-repo-url <url>', description: 'Backend repo URL (multirepo + existing)' },
      { flags: '--frontend-repo-url <url>', description: 'Frontend repo URL (multirepo + existing)' },
      { flags: '--db-setup <setup>', description: 'Database: `docker`, `credentials`, or `manual`' },
      { flags: '--db-type <type>', description: 'Database type: `postgresql` or `sql`' },
      { flags: '--email-service <service>', description: 'Email service: `none` or `mailersend`' },
      { flags: '--s3-setup <setup>', description: 'S3 storage: `docker`, `credentials`, or `manual`' },
      { flags: '--analytics / --no-analytics', description: 'Include (or skip) the analytics module' },
      { flags: '--advanced-skills <skills>', description: 'Comma-separated: `context7,atlassian,notion,figma`' },
      { flags: '--workflow <config> / --no-workflow', description: 'Workflow preset, `none`, or skip workflow entirely' },
      { flags: '--start-services / --no-start-services', description: 'Auto-start dev services (DB + MinIO) after setup' },
      { flags: '--start-apps <mode>', description: 'Apps to start after setup: `all`, `backend`, `frontend`, `none`' }
    ],
    examples: [
      '# Interactive wizard\nsf new',
      '# Scripted scaffold (monorepo, postgres via docker, no analytics)\nsf new --non-interactive \\\n  --project-name my-saas \\\n  --structure monorepo \\\n  --setup-repo local \\\n  --db-setup docker \\\n  --db-type postgresql \\\n  --email-service none \\\n  --no-analytics \\\n  --start-services --start-apps all'
    ],
    notes:
      'See `sf new --help` for the full flag surface (database credentials, MailerSend keys, S3 credentials, Atlassian/Notion/Figma tokens). Most flags are only validated when the relevant module is enabled.'
  },
  {
    name: 'sf update',
    description: 'Add modules to an existing SaaSFoundry project. Uses a three-way merge to preserve local edits while propagating upstream template evolutions.',
    usage: 'sf update [options]',
    options: [
      { flags: '--non-interactive', description: 'Fail if any required value is missing instead of prompting' },
      { flags: '--dry-run', description: 'Preview changes as JSON without writing files or running installers' },
      { flags: '--accept-template-updates', description: 'Auto-apply non-conflicting template updates without prompting' },
      {
        flags: '--conflict-strategy <strategy>',
        description: 'Three-way merge conflict handling: `keep` (yours), `replace` (theirs), or `save-new`',
        defaultValue: 'save-new'
      },
      {
        flags: '--add-modules <modules>',
        description:
          'Comma-separated list of modules to add: `email, storage, analytics, sf-skill-context7, sf-skill-atlassian, sf-skill-notion, sf-skill-figma`'
      },
      { flags: '--mailersend-api-key <key>', description: 'MailerSend API key (when adding `email`)' },
      { flags: '--s3-setup <setup>', description: 'S3 storage: `docker` or `credentials` (when adding `storage`)' },
      { flags: '--atlassian-email <email>', description: 'Atlassian account email (when adding `sf-skill-atlassian`)' },
      { flags: '--notion-api-token <token>', description: 'Notion API token (when adding `sf-skill-notion`)' },
      { flags: '--figma-api-token <token>', description: 'Figma API token (when adding `sf-skill-figma`)' }
    ],
    examples: [
      '# Interactive: select modules from the menu\nsf update',
      '# Preview what would change (no writes)\nsf update --dry-run --add-modules email,analytics',
      '# Scripted: add email + accept upstream template updates\nsf update --non-interactive \\\n  --add-modules email \\\n  --mailersend-api-key $MAILERSEND_KEY \\\n  --accept-template-updates'
    ],
    notes:
      '`sf update` is the mechanism for propagating upstream SaaSFoundry evolutions to projects you have already scaffolded — re-run it after upgrading the CLI to pull newer templates, scripts, and skill bundles.'
  },
  {
    name: 'sf modules',
    description: 'Browse the SaaSFoundry module catalogue, inspect module metadata, and rank modules against a natural-language intent.',
    usage: 'sf modules <subcommand> [options]',
    options: [
      { flags: 'list', description: 'List all modules with their installed state' },
      { flags: 'info <name>', description: 'Show detailed metadata for a single module' },
      { flags: 'match "<intent>"', description: 'Rank modules by how well they match a natural-language description' },
      { flags: '--json', description: 'Emit machine-readable JSON (available on all subcommands)' }
    ],
    examples: [
      '# List all catalogued modules\nsf modules list',
      '# Inspect the email module in JSON\nsf modules info email --json',
      '# Find modules relevant to "send transactional emails"\nsf modules match "send transactional emails"'
    ],
    notes:
      'The catalogue drives anti-reinvention guardrails: the `sf-tool-saasfoundry` skill calls `sf modules match` before the AI agent considers building a new module from scratch.'
  },
  {
    name: 'sf skill',
    description: 'Manage the lifecycle of the `tool-saasfoundry` Claude Code skill — install, update, or uninstall at user or project scope.',
    usage: 'sf skill <subcommand> [options]',
    options: [
      { flags: 'install', description: 'Install the skill (user scope by default)' },
      { flags: 'update', description: 'Re-copy the skill if the bundled version is newer than the installed one' },
      { flags: 'uninstall', description: 'Remove the skill from the chosen scope' },
      { flags: '--project', description: 'Operate on `.claude/skills/tool-saasfoundry/` (commit to git) instead of `~/.claude/skills/`' },
      { flags: '--force', description: 'Overwrite an existing installation without prompting' },
      { flags: '--yes, -y', description: 'Skip confirmation prompts (useful for CI)' },
      { flags: '--purge', description: 'When uninstalling, also delete preferences in `~/.saasfoundry/`' }
    ],
    examples: [
      '# Install the skill at user scope\nsf skill install',
      '# Install at project scope (team-shared, commit to git)\nsf skill install --project',
      '# Refresh the installed skill to the current CLI version\nsf skill update',
      '# Remove skill + preferences\nsf skill uninstall --purge'
    ],
    notes:
      'For a full wipe (both scopes + `~/.saasfoundry/`), use `sf uninstall --all` — the top-level convenience command.'
  },
  {
    name: 'sf feedback',
    description: 'File module requests, report bugs against the CLI or generated scaffolds, and vote on community-submitted proposals.',
    usage: 'sf feedback <subcommand> [options]',
    options: [
      { flags: 'request <name>', description: 'Open a new module-request issue on the SaaSFoundry repo' },
      { flags: 'bug', description: 'Open a bug report against the CLI or generated scaffolds' },
      { flags: 'list', description: 'List feedback issues (module-requests + cli-bugs + scaffold-bugs)' },
      { flags: 'vote --list', description: 'Show top module requests ranked by 👍 reactions' },
      { flags: 'vote <n> up|down|comment', description: 'Cast a reaction or post a comment on request #n' },
      { flags: '--description <text>', description: 'Issue description (request + bug)' },
      { flags: '--title <text>', description: 'Bug title' },
      { flags: '--source <cli|scaffold>', description: 'Which surface the bug affects (bug)' },
      { flags: '--auto-repro', description: 'Attach automatically captured reproduction context (bug)' },
      { flags: '--status <open|closed|all>', description: 'Filter issues by status (list)' },
      { flags: '--mine', description: 'Limit list to issues you opened' },
      { flags: '--limit <n>', description: 'Cap the number of returned results' },
      { flags: '--stack-filter <term>', description: 'Narrow vote --list results by stack keyword' },
      { flags: '--comment <body>', description: 'Comment body when voting with `comment`' },
      { flags: '--json', description: 'Emit machine-readable JSON output' },
      { flags: '--force', description: 'Skip duplicate-detection prompts when filing' },
      { flags: '--yes, -y', description: 'Skip interactive confirmations' },
      { flags: '--non-interactive', description: 'Fail instead of prompting (CI mode)' }
    ],
    examples: [
      '# Request a new module\nsf feedback request stripe-billing --description "Stripe subscription billing with webhooks"',
      '# File a CLI bug with auto-captured repro context\nsf feedback bug --source cli --title "sf update crashes on Windows" --auto-repro',
      '# List top-voted module requests\nsf feedback vote --list --limit 10',
      '# Upvote request #62\nsf feedback vote 62 up'
    ],
    notes:
      'Requests and bugs are deduplicated against the live GitHub issue list — the CLI surfaces similar existing issues before opening a new one. Pass `--force` to override.'
  },
  {
    name: 'sf tools',
    description: 'Manage multi-account credentials for external services (Atlassian, Notion, Figma) used by advanced Claude Code skills.',
    usage: 'sf tools [subcommand] [options]',
    options: [
      { flags: 'list', description: 'Show all tools and their account count' },
      { flags: 'accounts <tool>', description: 'List accounts for a specific tool' },
      { flags: 'add <tool> <account>', description: 'Add a new account for a tool' },
      { flags: 'use <tool> <account>', description: 'Set which account to use for current project' },
      { flags: 'current', description: 'Show accounts used by current project' }
    ],
    examples: [
      '# List all available tools\nsf tools list',
      '# Add a new Atlassian account\nsf tools add atlassian my-account',
      '# Use a specific account for current project\nsf tools use atlassian my-account',
      '# Show current project accounts\nsf tools current'
    ]
  },
  {
    name: 'sf workflow',
    description: 'Manage workflow configuration and AI rules for the 7-status complexity-adaptive workflow system.',
    usage: 'sf workflow [subcommand] [args...]',
    options: [
      { flags: 'show', description: 'Show current workflow configuration' },
      { flags: 'use <template>', description: 'Apply a workflow template' },
      { flags: 'set-working-branch <branch>', description: 'Set the working branch for git workflow' },
      { flags: 'set-ai-rules', description: 'Configure AI development rules' },
      { flags: 'validate', description: 'Validate workflow configuration' },
      { flags: 'save <template>', description: 'Save current config as template' },
      { flags: 'list', description: 'List available workflow templates' },
      { flags: 'create <template>', description: 'Create a new workflow template' },
      { flags: 'delete <template>', description: 'Delete a workflow template' },
      { flags: 'show-template <template>', description: 'Show a specific template' }
    ],
    examples: [
      '# Show current workflow config\nsf workflow show',
      '# Use an existing template\nsf workflow use my-template',
      '# Set working branch\nsf workflow set-working-branch develop',
      '# Configure AI rules\nsf workflow set-ai-rules',
      '# List available templates\nsf workflow list',
      '# Save current config as template\nsf workflow save my-template'
    ],
    notes:
      'The workflow system is complexity-adaptive: each ticket is tagged `bug | low | medium | complex`, which scales the ceremony (analyze depth, plan approval gates, adversarial review). See [Workflow System](/workflow/introduction) for the full lifecycle.'
  },
  {
    name: 'sf uninstall',
    description: 'Fully remove SaaSFoundry artefacts from the machine — the skill at both scopes plus `~/.saasfoundry/` preferences. Requires `--all`.',
    usage: 'sf uninstall --all [--yes]',
    options: [
      { flags: '--all', description: 'Required: remove skill (user + project scope) and wipe `~/.saasfoundry/`' },
      { flags: '--yes, -y', description: 'Skip the confirmation prompt' }
    ],
    examples: [
      '# Fully uninstall SaaSFoundry artefacts\nsf uninstall --all',
      '# CI-mode (no prompt)\nsf uninstall --all --yes'
    ],
    notes:
      'For per-scope removal, use `sf skill uninstall` instead. `sf uninstall` leaves the npm package itself installed — remove it with `npm uninstall -g saasfoundry-cli`.'
  }
]

async function main() {
  console.log('📚 Generating CLI documentation...\n')

  const docsDir = resolve(__dirname, '../docs/cli')

  for (const cmd of commands) {
    const filename = `${cmd.name.replace(' ', '-')}.md`
    const filepath = resolve(docsDir, filename)
    const content = generateCommandMarkdown(cmd)

    await writeFile(filepath, content, 'utf-8')
    console.log(`✓ Generated ${filename}`)
  }

  console.log('\n✅ CLI documentation generated successfully!')
  console.log('📝 Files created in docs/cli/')
}

main().catch((error) => {
  console.error('❌ Error generating documentation:', error)
  process.exit(1)
})
