#!/usr/bin/env node
'use strict'

// Turns a read-poc report into the move plan: what goes into POC/, what the folder looks
// like afterwards, and how to undo it. Emits the plan. Never touches the filesystem.
//
// The POC is normally local-only and never pushed anywhere, so the folder is the single
// existing copy of that work: no remote to recover from, often no history at all. Every
// refusal below exists because the alternative is destroying something unrecoverable.
//
// Input (stdin, JSON object):
//   {
//     "report":      <read-poc.js output>,
//     "destination": "POC"          // optional, defaults to POC
//   }
//
// Output (stdout, JSON object): see plan-poc-move.sh
//
// Exit codes:
//   0 — plan emitted, the move is safe to confirm
//   1 — internal error
//   2 — invalid input, or the move is refused (refusals are listed in the payload)

const fs = require('fs')
const path = require('path')

function bail(message) {
  process.stderr.write('plan-poc-move: ' + message + '\n')
  process.exit(2)
}

const raw = fs.readFileSync(0, 'utf8')
if (!raw.trim()) bail('empty input on stdin — pipe a read-poc.sh report')

let input
try {
  input = JSON.parse(raw)
} catch (err) {
  bail('invalid JSON on stdin: ' + err.message)
}

if (input === null || typeof input !== 'object' || Array.isArray(input)) {
  bail('input must be a JSON object with a "report" key')
}

// Accept a bare read-poc report too — it is the obvious thing to pipe, and rejecting it
// on a technicality would only teach people to wrap it by hand.
const report = input.report && typeof input.report === 'object' ? input.report : input

if (!report.root || typeof report.root !== 'string') {
  bail('report.root is missing — the input does not look like a read-poc report')
}
if (!report.inventory || typeof report.inventory !== 'object') {
  bail('report.inventory is missing — the input does not look like a read-poc report')
}

const destination = typeof input.destination === 'string' && input.destination.trim() ? input.destination.trim() : 'POC'

if (destination.includes('/') || destination.includes(path.sep) || destination === '.' || destination === '..') {
  bail('destination must be a single directory name, got "' + destination + '"')
}

const root = report.root

// ── what is actually in the folder ──────────────────────────────────────────────────
//
// Top-level entries, dotfiles and .git included. The plan is expressed at this level on
// purpose: moving whole top-level entries is one operation per entry, and it is undone by
// moving them back. A per-file plan would be neither.

let topLevel = []
try {
  topLevel = fs
    .readdirSync(root, { withFileTypes: true })
    .map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' }))
    .sort((a, b) => a.name.localeCompare(b.name))
} catch (err) {
  process.stderr.write('plan-poc-move: cannot read ' + root + ': ' + err.message + '\n')
  process.exit(1)
}

const refusals = []
const warnings = []

// 1. The destination must not already exist. Merging into it could silently overwrite,
//    and there is no copy anywhere to restore from.
if (topLevel.some((e) => e.name === destination)) {
  refusals.push(
    '"' + destination + '" already exists in this folder. Nothing is merged or overwritten — ' +
      'rename or remove it first, or pass a different destination.'
  )
}

// 2. A SaaSFoundryAI project is not a POC. Reorganising one would move a live project into
//    a reference folder, which is the opposite of what the user asked for.
if (topLevel.some((e) => e.name === '.saasfoundry.json')) {
  refusals.push(
    'this folder is already a SaaSFoundryAI project (.saasfoundry.json is present). ' +
      'A POC intake would file a live project away as a reference — use `sf update` instead.'
  )
}

// 3. Nothing to move.
if (report.inventory.files === 0) {
  refusals.push('the folder holds no files — there is nothing to move.')
}

// 4. The POC is a subdirectory of a repository nobody pointed us at. Moving it rewrites
//    paths in that repository's working tree.
if (report.git && report.git.isRepo && !report.git.ownRepo) {
  refusals.push(
    'this folder sits inside another git repository (' +
      report.git.enclosingRoot +
      '). Moving it would rewrite paths in a repository you did not point me at. ' +
      'Move the POC out of that repository first, or run the intake from its root.'
  )
}

// Warnings never block. The user may well want to file away a folder that cannot be read.
if (report.recognisable === false) {
  warnings.push('the folder is not recognisable as a POC (' + report.reason + ') — it can still be moved, but no reading of it was possible.')
}
if (report.inventory.truncated) {
  warnings.push('the folder is very large and the reading was truncated; the move itself is unaffected — whole top-level entries are moved.')
}
// .git is excluded here — it gets its own note below, and calling a repository a
// "generated directory" would be both wrong and alarming.
const generated = (report.inventory.generatedPresent || []).filter((d) => d !== '.git')
if (generated.length > 0) {
  warnings.push('generated directories move with the rest (' + generated.join(', ') + '); nothing is deleted.')
}

const moves = topLevel.map((entry) => ({
  from: entry.name,
  to: path.posix.join(destination, entry.name),
  type: entry.type
}))

const keepsGit = topLevel.some((e) => e.name === '.git')
if (keepsGit) {
  // Moving the whole working tree, .git included, leaves the repository intact: git
  // resolves tracked paths relative to its own root, so nothing is rewritten and the
  // history survives in full.
  warnings.push('the repository moves with its files — history is preserved in full and nothing is rewritten.')
}

const plan = {
  root,
  destination,
  refused: refusals.length > 0,
  refusals,
  warnings,
  moves,
  keepsGit,
  entriesMoved: moves.length,
  resultingTree: [destination + '/'],
  undo:
    'move every entry back out of ' +
    destination +
    '/ and remove the empty directory — the move is one level deep and reverses exactly'
}

process.stdout.write(JSON.stringify(plan, null, 2) + '\n')
process.exit(refusals.length > 0 ? 2 : 0)
