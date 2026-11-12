/**
 * Shared ESLint flat config for the hand-written packages/* workspaces
 * (shared-types, shared-validation, shared-config). Mirrors the prettier rule set used by
 * apps/api so the no-drift shared layers are linted with identical formatting expectations.
 */
import prettier from 'eslint-plugin-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  {
    // Test and tool outputs too: coverage reports ship minified scripts ESLint would lint (#1092)
    ignores: ['node_modules', 'dist', 'coverage', '.nyc_output', 'test-results']
  },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node
    },
    plugins: {
      prettier
    },
    rules: {
      'no-trailing-spaces': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prettier/prettier': [
        'error',
        {
          singleQuote: true,
          semi: false,
          trailingComma: 'none',
          printWidth: 200,
          proseWrap: 'always',
          endOfLine: 'lf',
          trimTrailingWhitespace: true
        }
      ]
    }
  }
]
