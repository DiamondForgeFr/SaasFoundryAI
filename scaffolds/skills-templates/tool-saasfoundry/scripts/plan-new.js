#!/usr/bin/env node
'use strict'

// Converts a JSON intent payload (read from stdin) into the equivalent
// `sf new --non-interactive ...` command on stdout. The manifest at
// ../reference/new-flags.json is the source of truth for the flag surface.
//
// Exit codes:
//   0 — success
//   1 — internal error (manifest missing)
//   2 — invalid intent (missing required field, bad enum, malformed JSON)

const fs = require('fs')
const path = require('path')

const manifestPath = path.join(__dirname, '..', 'reference', 'new-flags.json')

if (!fs.existsSync(manifestPath)) {
  process.stderr.write('plan-new: manifest not found at ' + manifestPath + '\n')
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

const intentRaw = fs.readFileSync(0, 'utf8')
if (!intentRaw.trim()) {
  process.stderr.write('plan-new: empty intent on stdin\n')
  process.exit(2)
}

let intent
try {
  intent = JSON.parse(intentRaw)
} catch (err) {
  process.stderr.write('plan-new: invalid JSON on stdin: ' + err.message + '\n')
  process.exit(2)
}

if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) {
  process.stderr.write('plan-new: intent must be a JSON object\n')
  process.exit(2)
}

for (const [key, spec] of Object.entries(manifest.fields)) {
  if (spec.required && (intent[key] === undefined || intent[key] === null || intent[key] === '')) {
    process.stderr.write('plan-new: missing required intent field: ' + key + '\n')
    process.exit(2)
  }
}

for (const [key, value] of Object.entries(intent)) {
  const spec = manifest.fields[key]
  if (!spec) continue
  if (spec.type === 'enum' && !spec.values.includes(value)) {
    process.stderr.write(
      'plan-new: invalid value "' + value + '" for ' + key +
      '; expected one of ' + spec.values.join(', ') + '\n'
    )
    process.exit(2)
  }
  if (spec.type === 'csv' && Array.isArray(value) && spec.values) {
    const bad = value.find((v) => !spec.values.includes(v))
    if (bad !== undefined) {
      process.stderr.write(
        'plan-new: invalid value "' + bad + '" in ' + key +
        '; expected one of ' + spec.values.join(', ') + '\n'
      )
      process.exit(2)
    }
  }
}

const parts = [...String(manifest.command).trim().split(/\s+/), ...manifest.alwaysAppend]

for (const [key, spec] of Object.entries(manifest.fields)) {
  const value = intent[key]
  if (value === undefined || value === null) continue

  if (spec.type === 'boolean') {
    if (value === true) parts.push(spec.flag)
    else if (value === false && spec.negationFlag) parts.push(spec.negationFlag)
    continue
  }

  if (spec.type === 'csv') {
    const items = Array.isArray(value)
      ? value
      : String(value).split(',').map((s) => s.trim()).filter(Boolean)
    if (items.length === 0) continue
    parts.push(spec.flag, items.join(','))
    continue
  }

  parts.push(spec.flag, String(value))
}

function quote(s) {
  if (/^[A-Za-z0-9_./@:-]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

process.stdout.write(parts.map(quote).join(' ') + '\n')
