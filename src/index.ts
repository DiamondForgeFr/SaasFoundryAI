import { Command } from 'commander'
import 'module-alias/register'
import { version } from '../package.json'
import { newCommand } from './commands/new'
import { updateCommand } from './commands/update'
import { toolsCommand } from './commands/tools'

const program = new Command()

program.name('sf').description('SaaSFoundry CLI - Create and manage your SaaS projects').version(version)
program.command('new').description('Create a new SaaSFoundry project').action(newCommand)
program.command('update').description('Add modules to an existing SaaSFoundry project').action(updateCommand)
program
  .command('tools')
  .description('Manage multi-account credentials for advanced skills')
  .argument('[subcommand]', 'Subcommand to execute (list, accounts, add, use, current)')
  .argument('[args...]', 'Additional arguments for the subcommand')
  .action(toolsCommand)
program.parse()

export { newCommand, updateCommand, toolsCommand }
