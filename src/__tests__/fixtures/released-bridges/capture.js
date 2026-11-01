#!/usr/bin/env node
/**
 * Capture the bytes a published saasfoundryai-cli release wrote (#935): the generated instruction
 * bridges it exports and the `.claude/settings.json` its harness installer deposited.
 *
 * Usage (see README.md):
 *   node capture.js <extracted package dir> <output dir>
 *
 * The package is read as published, never rebuilt. Its dependencies resolve through NODE_PATH.
 */
'use strict'

const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const [packageDir, outputDir] = process.argv.slice(2).map((path) => (path ? resolve(path) : path))
if (!packageDir || !outputDir) {
  console.error('Usage: node capture.js <extracted package dir> <output dir>')
  process.exit(2)
}

const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const instructions = require(join(packageDir, 'dist/harness/agent-instructions.js'))
const { installHarness } = require(join(packageDir, 'dist/installers/harness.installer.js'))

mkdirSync(outputDir, { recursive: true })
// An export the package does not have is a bridge that release never wrote: it gets no file.
const bridges = {
  'AGENTS.common.md': instructions.COMMON_INSTRUCTIONS,
  'AGENTS.adoption.md': instructions.ADOPTION_COMMON_INSTRUCTIONS,
  'CLAUDE.bridge.md': instructions.CODEX_SOURCE_CLAUDE_BRIDGE
}
for (const [name, content] of Object.entries(bridges)) {
  if (typeof content === 'string') writeFileSync(join(outputDir, name), content)
}

const project = mkdtempSync(join(tmpdir(), 'sf-released-harness-'))
installHarness({ targetPath: project, projectName: 'released-fixture', version, mainBranch: 'main' })
  .then(() => writeFileSync(join(outputDir, 'settings.json'), readFileSync(join(project, '.claude', 'settings.json'))))
  .finally(() => rmSync(project, { recursive: true, force: true }))
  .then(() => console.log(`Captured ${version} into ${outputDir}`))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
