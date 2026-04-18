#!/usr/bin/env node
'use strict'

// Evaluates a 5-criterion scorecard for a proposed module-request feedback
// issue and emits a structured decision the skill can speak from. Performs
// NO mutations and NO network calls — just scorecard + dedup analysis.
//
// Input (stdin, JSON object):
//   {
//     "intent": "real-time chat between project members",
//     "name": "chat",
//     "scorecard": {
//       "scopeFit":            "yes" | "no" | "unclear",
//       "reusability":         "yes" | "no" | "unclear",
//       "notAlreadySolvable":  "yes" | "no" | "unclear",
//       "opinionOwnership":    "yes" | "no" | "unclear",
//       "maintenanceRealism":  "yes" | "no" | "unclear"
//     },
//     "description": "optional longer pitch the skill drafted with the user",
//     "existingIssues": [
//       { "number": 42, "title": "[request] chat", "state": "open",
//         "url": "https://github.com/.../42", "labels": ["module-request"] }
//     ]
//   }
//
// Output (stdout, JSON object):
//   {
//     intent: string,
//     name: string,
//     decision: "file-request" | "route-to-existing" | "refuse",
//     redFlags: [{ criterion, answer, reason }],   // empty unless refuse
//     duplicate: { number, title, url, state } | null,
//     recommendation: {
//       action: "run-command" | "route-to-existing" | "refuse",
//       command: string | null,
//       message: string
//     }
//   }
//
// Decision rules:
//   - Any criterion answered "no"        → refuse, list red flags
//   - Any criterion answered "unclear"   → refuse (ask user to resolve first)
//   - All five "yes" AND duplicate found → route-to-existing
//   - All five "yes" AND no duplicate    → file-request (emit sf command)
//
// Exit codes:
//   0 — success
//   2 — invalid input (empty stdin, malformed JSON, missing required keys)

const fs = require('fs')

const CRITERIA = ['scopeFit', 'reusability', 'notAlreadySolvable', 'opinionOwnership', 'maintenanceRealism']
const ANSWERS = new Set(['yes', 'no', 'unclear'])

const REFUSAL_REASONS = {
  scopeFit: 'Out of SaaSFoundry scope — the skill should not file a request for a feature that does not belong in the SaaS baseline.',
  reusability: 'Low reusability — at least 3 unrelated projects should plausibly want this before it earns a slot in the catalogue.',
  notAlreadySolvable: 'Already solvable — an existing module or a small custom implementation covers this cleanly; no new module warranted.',
  opinionOwnership: 'No strong opinion — SaaSFoundry modules are opinionated; without a clear "right way" the module would drift.',
  maintenanceRealism: 'Maintenance risk — vendor churn, heavy deps, or fragile upstream makes long-term ownership unrealistic.'
}

const raw = fs.readFileSync(0, 'utf8')
if (!raw.trim()) {
  process.stderr.write('plan-feedback-request: empty input on stdin\n')
  process.exit(2)
}

let input
try {
  input = JSON.parse(raw)
} catch (err) {
  process.stderr.write('plan-feedback-request: invalid JSON on stdin: ' + err.message + '\n')
  process.exit(2)
}

if (input === null || typeof input !== 'object' || Array.isArray(input)) {
  process.stderr.write('plan-feedback-request: input must be a JSON object\n')
  process.exit(2)
}

if (typeof input.intent !== 'string' || !input.intent.trim()) {
  process.stderr.write('plan-feedback-request: input.intent must be a non-empty string\n')
  process.exit(2)
}

if (typeof input.name !== 'string' || !input.name.trim()) {
  process.stderr.write('plan-feedback-request: input.name must be a non-empty string (proposed module slug)\n')
  process.exit(2)
}

if (!input.scorecard || typeof input.scorecard !== 'object' || Array.isArray(input.scorecard)) {
  process.stderr.write('plan-feedback-request: input.scorecard must be an object with 5 criteria\n')
  process.exit(2)
}

for (const criterion of CRITERIA) {
  const answer = input.scorecard[criterion]
  if (typeof answer !== 'string' || !ANSWERS.has(answer)) {
    process.stderr.write('plan-feedback-request: input.scorecard.' + criterion + ' must be one of "yes" | "no" | "unclear"\n')
    process.exit(2)
  }
}

const existingIssues = Array.isArray(input.existingIssues) ? input.existingIssues : []

const redFlags = []
for (const criterion of CRITERIA) {
  const answer = input.scorecard[criterion]
  if (answer === 'no' || answer === 'unclear') {
    redFlags.push({
      criterion,
      answer,
      reason: REFUSAL_REASONS[criterion]
    })
  }
}

const nameLc = input.name.toLowerCase()
const intentLc = input.intent.toLowerCase()
const duplicate =
  existingIssues.find((issue) => {
    if (!issue || typeof issue.title !== 'string') return false
    const title = issue.title.toLowerCase()
    if (title.includes(nameLc)) return true
    const nameTokens = nameLc.split(/[\s-_]+/).filter((t) => t.length >= 4)
    const intentTokens = intentLc.split(/[\s-_]+/).filter((t) => t.length >= 4)
    const tokens = new Set([...nameTokens, ...intentTokens])
    for (const token of tokens) {
      if (title.includes(token)) return true
    }
    return false
  }) || null

let decision
let recommendation

if (redFlags.length > 0) {
  decision = 'refuse'
  const criteriaList = redFlags.map((f) => f.criterion + '=' + f.answer).join(', ')
  recommendation = {
    action: 'refuse',
    command: null,
    message: 'Refused: the scorecard has ' + redFlags.length + ' red flag' + (redFlags.length === 1 ? '' : 's') + ' (' + criteriaList + '). Explain the red flags to the user before filing anything.'
  }
} else if (duplicate) {
  decision = 'route-to-existing'
  recommendation = {
    action: 'route-to-existing',
    command: null,
    message: 'Duplicate found: issue #' + duplicate.number + ' — "' + duplicate.title + '". Route the user there (sf feedback vote ' + duplicate.number + ' up) instead of filing a new request.'
  }
} else {
  decision = 'file-request'
  let command = 'sf feedback request ' + input.name
  if (typeof input.description === 'string' && input.description.trim()) {
    const safe = input.description.replace(/"/g, '\\"')
    command += ' --description "' + safe + '"'
  }
  recommendation = {
    action: 'run-command',
    command,
    message: 'Scorecard all green and no duplicate found. File the request with: ' + command
  }
}

const reportedDuplicate = decision === 'route-to-existing' && duplicate ? duplicate : null

const output = {
  intent: input.intent,
  name: input.name,
  decision,
  redFlags,
  duplicate: reportedDuplicate
    ? {
        number: reportedDuplicate.number,
        title: reportedDuplicate.title,
        url: typeof reportedDuplicate.url === 'string' ? reportedDuplicate.url : null,
        state: typeof reportedDuplicate.state === 'string' ? reportedDuplicate.state : null
      }
    : null,
  recommendation
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n')
