export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        // #1232: the scope is the number of a ticket that exists. A placeholder (#TBD, #XXX) is no
        // ticket: work committed under it reaches no board and no pull request.
        'ticket-reference': ({ header }) => {
          const scope = /^\w+\(([^)]*)\)/.exec(header ?? '')?.[1]
          if (scope === undefined || /^#\d+$/.test(scope)) return [true]
          return [
            false,
            `the scope must be the number of an existing ticket, as (#123): (${scope}) is not one. ` +
              'Create the ticket before the first commit; when the ticket tool is unreachable, stop and report it to the developer'
          ]
        }
      }
    }
  ],
  rules: {
    'ticket-reference': [2, 'always'], // #1232: (#<number>), never a placeholder
    'type-enum': [
      2,
      'always',
      [
        'feat', // New features
        'fix', // Bug fixes
        'docs', // Documentation
        'style', // Formatting, missing semi colons, etc
        'refactor', // Code refactoring
        'perf', // Performance improvements
        'test', // Adding or updating tests
        'chore', // Maintenance tasks
        'ci', // CI/CD related
        'build', // Build system
        'revert' // Revert changes
      ]
    ],
    'scope-empty': [2, 'never'], // Scope is required
    'scope-case': [0], // Disable scope case validation
    'subject-case': [0], // Disable subject case validation
    'header-max-length': [2, 'always', 100], // Line length
    'scope-enum': [0, 'never'] // Disable scope enum to allow any scope
  },
  parserPreset: {
    parserOpts: {
      headerPattern: /^(\w*)\(#(\d+)\): (.*)$/,
      headerCorrespondence: ['type', 'scope', 'subject']
    }
  }
}
