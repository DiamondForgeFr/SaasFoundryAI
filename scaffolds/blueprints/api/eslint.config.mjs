import jsoncPlugin from 'eslint-plugin-jsonc'
import prettier from 'eslint-plugin-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import noVersionPrefixPlugin from './eslint-rules/no-version-prefix.mjs'

export default [
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      'src/generated',
      // Test and tool outputs: coverage reports ship minified scripts that keep ESLint busy for
      // minutes after a coverage run (#1092)
      'coverage',
      'coverage-e2e',
      '.nyc_output',
      'test-results'
    ]
  },

  ...tseslint.configs.recommended,

  // TypeScript files config
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node
    },
    plugins: {
      prettier: prettier
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
  },

  // JSON files config
  {
    files: ['package.json'],
    plugins: {
      jsonc: jsoncPlugin.default || jsoncPlugin,
      'no-version-prefix': noVersionPrefixPlugin
    },
    languageOptions: {
      parser: jsoncPlugin.parsers?.jsonc || jsoncPlugin.parsers
    },
    rules: {
      'jsonc/no-useless-escape': 'error',
      'jsonc/sort-keys': 'error',
      'no-version-prefix/no-version-prefix': 'error',
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  }
]
