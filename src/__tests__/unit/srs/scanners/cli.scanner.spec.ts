import { extractCliCommands } from '../../../../srs/scanners/cli.scanner'

describe('extractCliCommands (pure)', () => {
  it('pairs each command with the description in its own chain', () => {
    const source = `
program
  .command('new')
  .description('Create a new project')
  .action(newCommand)
program
  .command('update')
  .description('Add modules to an existing project')
  .action(updateCommand)
`
    expect(extractCliCommands(source)).toEqual([
      { name: 'new', description: 'Create a new project' },
      { name: 'update', description: 'Add modules to an existing project' }
    ])
  })

  it('does not leak a description across the next command in the chain', () => {
    const source = `
program.command('first').action(a)
program.command('second').description('belongs to second').action(b)
`
    const commands = extractCliCommands(source)
    expect(commands[0]).toEqual({ name: 'first', description: undefined })
    expect(commands[1]).toEqual({ name: 'second', description: 'belongs to second' })
  })

  it('keeps only the command name when an argument spec is attached', () => {
    expect(extractCliCommands(`program.command('deploy <env>')`)[0].name).toBe('deploy')
  })

  it('returns nothing for a file that registers no command', () => {
    expect(extractCliCommands('export const x = 1')).toEqual([])
  })

  // The point of the scanner: `endpoint` is any invocable operation, not just an HTTP route.
  // Without it a CLI project produced ZERO implementation findings, and `sf srs eval` scored
  // its FRs against test files and documentation headings instead of against code.
  it('extracts every command from a realistic Commander entrypoint', () => {
    const source = ['new', 'update', 'modules', 'status', 'workflow'].map((c) => `program\n  .command('${c}')\n  .description('${c} does things')\n  .action(x)`).join('\n')
    expect(extractCliCommands(source).map((c) => c.name)).toEqual(['new', 'update', 'modules', 'status', 'workflow'])
  })
})
