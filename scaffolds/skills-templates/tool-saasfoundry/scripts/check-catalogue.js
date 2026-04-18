#!/usr/bin/env node
'use strict'

// Consolidates a user intent and `sf modules match --json` output into a
// tiered recommendation the skill can speak from. Performs NO mutations and
// NO network calls — just classifies the match score.
//
// Input (stdin, JSON object):
//   {
//     "intent": "send transactional emails",
//     "match": {
//       "cliVersion": "1.0.0-beta",
//       "intent": "send transactional emails",
//       "results": [
//         { "name": "email", "displayName": "Email Service", "category": "…",
//           "score": 15, "reasons": ["keywords: send, emails", …] },
//         …
//       ]
//     }
//   }
//
// Output (stdout, JSON object):
//   {
//     intent: string,
//     tier: "HIGH" | "MEDIUM" | "LOW" | "NONE",
//     topMatch: { name, displayName, category, score, reasons } | null,
//     recommendation: {
//       action: "propose-update" | "confirm-with-user" | "route-to-feedback",
//       command: "sf update --add-modules <name>" | null,
//       message: string
//     }
//   }
//
// Thresholds (raw scores from sf modules match):
//   HIGH    score >= 6   → strong match, propose sf update
//   MEDIUM  3 <= score <= 5 → possible match, confirm with user before proposing
//   LOW     1 <= score <= 2 → weak signal, route to feedback request
//   NONE    no results / score 0 → route to feedback request
//
// Exit codes:
//   0 — success
//   2 — invalid input (empty stdin, malformed JSON, missing required keys)

const fs = require('fs')

const HIGH_THRESHOLD = 6
const MEDIUM_THRESHOLD = 3
const LOW_THRESHOLD = 1

const raw = fs.readFileSync(0, 'utf8')
if (!raw.trim()) {
  process.stderr.write('check-catalogue: empty input on stdin\n')
  process.exit(2)
}

let input
try {
  input = JSON.parse(raw)
} catch (err) {
  process.stderr.write('check-catalogue: invalid JSON on stdin: ' + err.message + '\n')
  process.exit(2)
}

if (input === null || typeof input !== 'object' || Array.isArray(input)) {
  process.stderr.write('check-catalogue: input must be a JSON object\n')
  process.exit(2)
}

if (typeof input.intent !== 'string' || !input.intent.trim()) {
  process.stderr.write('check-catalogue: input.intent must be a non-empty string\n')
  process.exit(2)
}

if (!input.match || typeof input.match !== 'object' || Array.isArray(input.match)) {
  process.stderr.write('check-catalogue: input.match must be the sf modules match --json object\n')
  process.exit(2)
}

if (!Array.isArray(input.match.results)) {
  process.stderr.write('check-catalogue: input.match.results must be an array\n')
  process.exit(2)
}

const results = input.match.results
const topMatch = results.length > 0 ? results[0] : null
const topScore = topMatch && typeof topMatch.score === 'number' ? topMatch.score : 0

let tier
if (topScore >= HIGH_THRESHOLD) tier = 'HIGH'
else if (topScore >= MEDIUM_THRESHOLD) tier = 'MEDIUM'
else if (topScore >= LOW_THRESHOLD) tier = 'LOW'
else tier = 'NONE'

let recommendation
if (tier === 'HIGH') {
  recommendation = {
    action: 'propose-update',
    command: 'sf update --add-modules ' + topMatch.name,
    message:
      'Strong match: "' +
      topMatch.displayName +
      '" (score ' +
      topScore +
      '). Propose `sf update` before letting the user custom-code this.'
  }
} else if (tier === 'MEDIUM') {
  recommendation = {
    action: 'confirm-with-user',
    command: 'sf update --add-modules ' + topMatch.name,
    message:
      'Possible match: "' +
      topMatch.displayName +
      '" (score ' +
      topScore +
      '). Confirm with the user that this is what they mean before proposing `sf update`.'
  }
} else {
  recommendation = {
    action: 'route-to-feedback',
    command: null,
    message:
      tier === 'NONE'
        ? 'No catalogue match for this intent. If it would benefit other projects, suggest `sf feedback request` (Phase 3B scorecard applies).'
        : 'Weak match only (score ' +
          topScore +
          '). Treat as no-match and route to `sf feedback request` if the user wants to push for inclusion.'
  }
}

const output = {
  intent: input.intent,
  tier,
  topMatch: topMatch
    ? {
        name: topMatch.name,
        displayName: topMatch.displayName,
        category: topMatch.category,
        score: topScore,
        reasons: Array.isArray(topMatch.reasons) ? topMatch.reasons : []
      }
    : null,
  recommendation
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n')
