#!/usr/bin/env node
// Prints the GitHub Release notes of a version: its `## [X.Y.Z]` section of docs/changelog.md,
// then the install command and a link to the full changelog (#904). Exits 1 when the section
// is missing or empty, which stops the publish before a release without notes.
import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: node scripts/release-notes.mjs <X.Y.Z>')
  process.exit(2)
}

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const changelog = read('docs/changelog.md')
const { name, repository } = JSON.parse(read('package.json'))
const repositoryUrl = String(repository?.url ?? repository ?? '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')

const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\](?: - .*)?$`, 'm')
const match = heading.exec(changelog)
if (!match) {
  console.error(`docs/changelog.md has no "## [${version}]" section: add it before tagging v${version}.`)
  process.exit(1)
}
const rest = changelog.slice(match.index + match[0].length)
const next = rest.search(/^## \[/m)
const section = (next === -1 ? rest : rest.slice(0, next)).trim()
if (!section) {
  console.error(`The "## [${version}]" section of docs/changelog.md is empty.`)
  process.exit(1)
}

process.stdout.write(`${section}\n\nInstall: \`npm install -g ${name}@${version}\`\n\nSee the [changelog](${repositoryUrl}/blob/v${version}/docs/changelog.md) for every release.\n`)
