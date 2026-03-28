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
}

/**
 * Generate markdown documentation for a CLI command
 */
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
      const defaultVal = opt.defaultValue ? `\`${opt.defaultValue}\`` : '-'
      md += `| \`${opt.flags}\` | ${opt.description} | ${defaultVal} |\n`
    }
    md += `\n`
  }

  if (cmd.examples.length > 0) {
    md += `## Examples\n\n`
    for (const example of cmd.examples) {
      md += `\`\`\`bash\n${example}\n\`\`\`\n\n`
    }
  }

  md += `## See Also\n\n`
  md += `- [CLI Commands](/cli/sf-new)\n`
  md += `- [Getting Started](/getting-started/quick-start)\n`

  return md
}

/**
 * Command definitions
 * TODO: Extract these automatically from Commander definitions in src/index.ts
 */
const commands: CommandDoc[] = [
  {
    name: 'sf new',
    description: 'Create a new SaaSFoundry project with interactive prompts.',
    usage: 'sf new',
    options: [],
    examples: ['# Create a new project\nsf new', '# Follow the interactive prompts to configure your project']
  },
  {
    name: 'sf update',
    description: 'Add modules to an existing SaaSFoundry project.',
    usage: 'sf update',
    options: [],
    examples: ['# Add modules to current project\nsf update', '# Select modules from the interactive menu']
  },
  {
    name: 'sf tools',
    description: 'Manage multi-account credentials for various services (Atlassian, Notion, Figma).',
    usage: 'sf tools [subcommand] [options]',
    options: [
      {
        flags: 'list',
        description: 'Show all tools and their account count'
      },
      {
        flags: 'accounts <tool>',
        description: 'List accounts for a specific tool'
      },
      {
        flags: 'add <tool> <account>',
        description: 'Add a new account for a tool'
      },
      {
        flags: 'use <tool> <account>',
        description: 'Set which account to use for current project'
      },
      {
        flags: 'current',
        description: 'Show accounts used by current project'
      }
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
    description: 'Manage workflow configuration and templates for project management tools.',
    usage: 'sf workflow [subcommand] [args...]',
    options: [
      {
        flags: 'show',
        description: 'Show current workflow configuration'
      },
      {
        flags: 'use <template>',
        description: 'Apply a workflow template'
      },
      {
        flags: 'set-working-branch <branch>',
        description: 'Set the working branch for git workflow'
      },
      {
        flags: 'set-ai-rules',
        description: 'Configure AI development rules'
      },
      {
        flags: 'validate',
        description: 'Validate workflow configuration'
      },
      {
        flags: 'save <template>',
        description: 'Save current config as template'
      },
      {
        flags: 'list',
        description: 'List available workflow templates'
      },
      {
        flags: 'create <template>',
        description: 'Create a new workflow template'
      },
      {
        flags: 'delete <template>',
        description: 'Delete a workflow template'
      },
      {
        flags: 'show-template <template>',
        description: 'Show a specific template'
      }
    ],
    examples: [
      '# Show current workflow config\nsf workflow show',
      '# Use an existing template\nsf workflow use my-template',
      '# Set working branch\nsf workflow set-working-branch develop',
      '# Configure AI rules\nsf workflow set-ai-rules',
      '# List available templates\nsf workflow list',
      '# Save current config as template\nsf workflow save my-template'
    ]
  }
]

/**
 * Main function
 */
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
