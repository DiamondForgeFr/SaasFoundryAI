#!/usr/bin/env node
'use strict'

// Consolidates .saasfoundry.json, the canonical `sf status --json` capability
// classification and `sf modules list --json` into one read-only report.
// This script performs NO mutations — route every update through plan-update.sh.
//
// Input (stdin, JSON object):
//   {
//     "manifest": <contents of .saasfoundry.json>,
//     "catalogue": [<sf modules list --json entries>],
//     "status": <sf status --json output, optional for legacy callers>
//   }
//
// Output (stdout, JSON object):
//   {
//     project: { name, structure, cliVersion, generatedAt, capabilities },
//     modules: {
//       installed: [string],         // derived from manifest.modules
//       available: [string],         // every catalogue entry name
//       newlyAvailable: [string],    // in catalogue, not installed
//       obsolete: [{name, minCliVersion}]   // catalogue minCliVersion > manifest.version
//     },
//     upToDate: boolean              // false when any installed module has minCliVersion > manifest.version
//   }
//
// Exit codes:
//   0 — success
//   2 — invalid input (missing/empty stdin, malformed JSON, missing manifest or catalogue)

const fs = require('fs')

const raw = fs.readFileSync(0, 'utf8')
if (!raw.trim()) {
  process.stderr.write('read-project: empty input on stdin\n')
  process.exit(2)
}

let input
try {
  input = JSON.parse(raw)
} catch (err) {
  process.stderr.write('read-project: invalid JSON on stdin: ' + err.message + '\n')
  process.exit(2)
}

if (input === null || typeof input !== 'object' || Array.isArray(input)) {
  process.stderr.write('read-project: input must be a JSON object with "manifest" and "catalogue" keys\n')
  process.exit(2)
}

const manifest = input.manifest
const catalogue = input.catalogue
const status = input.status

if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
  process.stderr.write('read-project: input.manifest must be the .saasfoundry.json object\n')
  process.exit(2)
}

if (!Array.isArray(catalogue)) {
  process.stderr.write('read-project: input.catalogue must be an array (output of `sf modules list --json`)\n')
  process.exit(2)
}

if (status !== undefined && status !== null && (typeof status !== 'object' || Array.isArray(status))) {
  process.stderr.write('read-project: input.status must be the `sf status --json` object or null\n')
  process.exit(2)
}

const capabilities = status && status.capabilities && typeof status.capabilities === 'object' ? status.capabilities : null

function deriveInstalled(m, canonicalCapabilities) {
  const installed = []
  const mods = m.modules || {}
  // Support both legacy `emailService` (manifestVersion < 2) and the current
  // nested `email.provider` shape — read-project may be invoked against an
  // un-migrated manifest in older projects.
  const emailProvider = (mods.email && mods.email.provider) || mods.emailService
  if (emailProvider && emailProvider !== 'none') installed.push('email')
  if (mods.s3Setup) installed.push('storage')
  if (mods.includeAnalytics === true) installed.push('analytics')
  if (canonicalCapabilities && canonicalCapabilities.collaborationHarness === 'managed') installed.push('harness')
  if (Array.isArray(mods.advancedSkills)) {
    for (const s of mods.advancedSkills) installed.push('sf-skill-' + s)
  }
  return installed
}

function compareSemver(a, b) {
  const toParts = (v) =>
    String(v)
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0)
  const [aMaj, aMin, aPatch] = toParts(a)
  const [bMaj, bMin, bPatch] = toParts(b)
  if (aMaj !== bMaj) return aMaj - bMaj
  if (aMin !== bMin) return aMin - bMin
  return aPatch - bPatch
}

const installed = deriveInstalled(manifest, capabilities)
const installedSet = new Set(installed)
const available = catalogue.map((c) => c.name)
const newlyAvailable = available.filter((n) => !installedSet.has(n))

const cliVersion = manifest.version || 'unknown'
const obsolete = []
for (const entry of catalogue) {
  if (!installedSet.has(entry.name)) continue
  if (!entry.minCliVersion) continue
  if (compareSemver(entry.minCliVersion, cliVersion) > 0) {
    obsolete.push({ name: entry.name, minCliVersion: entry.minCliVersion })
  }
}

const report = {
  project: {
    name: manifest.projectName || 'unknown',
    structure: manifest.structure || 'unknown',
    cliVersion,
    generatedAt: manifest.generatedAt || null,
    capabilities
  },
  modules: {
    installed,
    available,
    newlyAvailable,
    obsolete
  },
  upToDate: obsolete.length === 0
}

process.stdout.write(JSON.stringify(report, null, 2) + '\n')
