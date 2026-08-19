#!/usr/bin/env node
'use strict'

// Classifies a passively-observed (or user-initiated) SaaSFoundryAI failure into
// a bug-report intent the skill can speak from. Performs NO mutations and NO
// network calls — just label routing, stderr redaction, and command planning.
//
// Input (stdin, JSON object):
//   {
//     "source": "cli-invocation" | "scaffold-build" | "manual",
//     "title": "Short human-readable title",
//     "description": "Optional longer pitch; combined with stderr excerpt",
//     "command":  "sf new --non-interactive ...", // optional but recommended
//     "exitCode": 1,                              // optional (cli-invocation)
//     "stderr":   "multi-line stderr from the failing process",
//     "context":  "cli" | "scaffold" | null,      // optional override
//     "userConfirmed": true                       // REQUIRED to file
//   }
//
// Output (stdout, JSON object):
//   {
//     source: "cli-invocation" | "scaffold-build" | "manual",
//     label: "cli-bug" | "scaffold-bug",
//     title: string,
//     description: string,       // built from input.description + redacted stderr
//     redactedStderr: string,    // empty string if no stderr on input
//     decision: "file-bug" | "refuse",
//     recommendation: {
//       action: "run-command" | "refuse",
//       command: string | null,   // sf feedback bug --source ... --title ... ...
//       message: string
//     }
//   }
//
// Decision rules:
//   - userConfirmed !== true                  → refuse (never file silently)
//   - source === "scaffold-build"             → label = scaffold-bug
//   - source === "cli-invocation"             → label = cli-bug
//   - source === "manual" + context override  → honour the override
//   - source === "manual" without override    → default to cli-bug
//
// Exit codes:
//   0 — success
//   2 — invalid input (empty stdin, malformed JSON, missing required keys,
//                      unknown source, or empty title)

const fs = require('fs')

const VALID_SOURCES = new Set(['cli-invocation', 'scaffold-build', 'manual'])
const VALID_CONTEXTS = new Set(['cli', 'scaffold'])

// Ordered most-specific → least-specific so narrower redactions win when a
// line matches multiple patterns.
const REDACTIONS = [
  // JWTs: three base64url chunks separated by dots
  { pattern: /\bey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '<jwt>' },
  // Provider-prefixed tokens: GitHub (ghp/gho/ghs/ghu/ghr/github_pat), OpenAI (sk-), Stripe (sk_live/sk_test/rk_), Slack (xox[abpors]-)
  { pattern: /\bghp_[A-Za-z0-9]{30,}\b/g, replacement: '<github-token>' },
  { pattern: /\bgho_[A-Za-z0-9]{30,}\b/g, replacement: '<github-token>' },
  { pattern: /\bghs_[A-Za-z0-9]{30,}\b/g, replacement: '<github-token>' },
  { pattern: /\bghu_[A-Za-z0-9]{30,}\b/g, replacement: '<github-token>' },
  { pattern: /\bghr_[A-Za-z0-9]{30,}\b/g, replacement: '<github-token>' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: '<github-token>' },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: '<api-key>' },
  { pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g, replacement: '<stripe-key>' },
  { pattern: /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/g, replacement: '<slack-token>' },
  // Authorization headers
  { pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{10,}/g, replacement: 'Bearer <redacted>' },
  { pattern: /\b[Bb]asic\s+[A-Za-z0-9+/=]{10,}/g, replacement: 'Basic <redacted>' },
  // CLI arg / env / query-string secrets: --token=xxx, token=xxx, SECRET_KEY=xxx, password: "xxx"
  { pattern: /(--(?:token|password|secret|api[-_]?key|auth|access[-_]?token|refresh[-_]?token)[=\s])[^\s&"']+/gi, replacement: '$1<redacted>' },
  { pattern: /\b([A-Z][A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_?KEY|AUTH|PRIVATE_?KEY))\s*[:=]\s*["']?[^"'\s]+["']?/g, replacement: '$1=<redacted>' },
  { pattern: /([?&](?:token|password|secret|api[-_]?key|auth|access[-_]?token|refresh[-_]?token)=)[^&\s]+/gi, replacement: '$1<redacted>' },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '<email>' },
  // Home paths (macOS, Linux, Windows) — keep the prefix so line numbers/files remain useful
  { pattern: /\/Users\/[^/\s:"']+/g, replacement: '/Users/<user>' },
  { pattern: /\/home\/[^/\s:"']+/g, replacement: '/home/<user>' },
  { pattern: /C:\\Users\\[^\\\s:"']+/gi, replacement: 'C:\\Users\\<user>' }
]

function redactStderr(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  let out = raw
  for (const { pattern, replacement } of REDACTIONS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

function classifyLabel(source, context) {
  if (source === 'scaffold-build') return 'scaffold-bug'
  if (source === 'cli-invocation') return 'cli-bug'
  // manual: honour context override, default cli-bug
  if (context === 'scaffold') return 'scaffold-bug'
  return 'cli-bug'
}

function shellQuote(s) {
  if (s == null || s === '') return "''"
  if (!/[^A-Za-z0-9_\-./=:,]/.test(s)) return s
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

function buildDescription(userDescription, redactedStderr, command, exitCode) {
  const parts = []
  if (typeof userDescription === 'string' && userDescription.trim()) {
    parts.push(userDescription.trim())
  }
  if (typeof command === 'string' && command.trim()) {
    parts.push('**Command:** `' + command.trim() + '`')
  }
  if (typeof exitCode === 'number' && Number.isFinite(exitCode)) {
    parts.push('**Exit code:** ' + exitCode)
  }
  if (redactedStderr) {
    parts.push('**Stderr (credentials redacted):**')
    parts.push('```\n' + redactedStderr.trim() + '\n```')
  }
  return parts.join('\n\n')
}

function buildCommand(label, title, description) {
  const source = label === 'scaffold-bug' ? 'scaffold' : 'cli'
  const args = ['sf feedback bug', '--source ' + source, '--title ' + shellQuote(title), '--description ' + shellQuote(description), '--auto-repro', '--yes']
  return args.join(' ')
}

const raw = fs.readFileSync(0, 'utf8')
if (!raw.trim()) {
  process.stderr.write('plan-feedback-bug: empty input on stdin\n')
  process.exit(2)
}

let input
try {
  input = JSON.parse(raw)
} catch (err) {
  process.stderr.write('plan-feedback-bug: invalid JSON on stdin: ' + err.message + '\n')
  process.exit(2)
}

if (input === null || typeof input !== 'object' || Array.isArray(input)) {
  process.stderr.write('plan-feedback-bug: input must be a JSON object\n')
  process.exit(2)
}

if (typeof input.source !== 'string' || !VALID_SOURCES.has(input.source)) {
  process.stderr.write('plan-feedback-bug: input.source must be one of ' + Array.from(VALID_SOURCES).join(' | ') + '\n')
  process.exit(2)
}

if (typeof input.title !== 'string' || !input.title.trim()) {
  process.stderr.write('plan-feedback-bug: input.title must be a non-empty string\n')
  process.exit(2)
}

if (input.context != null && !VALID_CONTEXTS.has(input.context)) {
  process.stderr.write('plan-feedback-bug: input.context, when present, must be "cli" or "scaffold"\n')
  process.exit(2)
}

const source = input.source
const context = typeof input.context === 'string' ? input.context : null
const label = classifyLabel(source, context)
const redactedStderr = redactStderr(input.stderr)
const description = buildDescription(input.description, redactedStderr, input.command, input.exitCode)
const title = input.title.trim()

let decision
let recommendation

if (input.userConfirmed !== true) {
  decision = 'refuse'
  recommendation = {
    action: 'refuse',
    command: null,
    message: 'Refused: userConfirmed is not true. The skill MUST obtain explicit user approval before filing any bug report — never file silently on a failure signal.'
  }
} else {
  decision = 'file-bug'
  const command = buildCommand(label, title, description)
  recommendation = {
    action: 'run-command',
    command,
    message: 'Confirmed. File the ' + label + ' with: ' + command
  }
}

const output = {
  source,
  label,
  title,
  description,
  redactedStderr,
  decision,
  recommendation
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n')
