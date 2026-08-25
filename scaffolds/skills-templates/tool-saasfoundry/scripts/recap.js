#!/usr/bin/env node
'use strict'

// Answers "where are we in the zero-to-project flow" from state on disk and on the board,
// never from the conversation. A user who closes the session and comes back is told where
// they are; a session that has lost its history can still pick the flow up.
//
// It CONSUMES `sf status --json` rather than reimplementing it. That command already
// decides whether the manifest, workflow and SRS are configured, and each precondition it
// returns already carries its own remediation. Re-deriving that here would create a second
// source of truth for "is the SRS configured", and the two would drift — which is the
// failure this whole project keeps finding in its own history.
//
// What this adds is the flow-local evidence sf status has no reason to know: whether a POC
// was filed, whether the challenge was recorded, whether the SRS has any pages, whether
// the board carries tickets.
//
// Input (stdin, JSON):
//   {
//     "status":  <sf status --json output: { report, preconditions }>,   // optional
//     "signals": {
//        "pocFiled":     boolean,          // POC/ exists
//        "intakeEntries": number|null,     // answers in intake.json, null if absent
//        "manifestPath": string|null,      // .saasfoundry.json found here
//        "srsPages":     number|null,      // pages under the SRS root; null = not checked
//        "boardTickets": number|null       // issues on the board;      null = not checked
//     },
//     "network": boolean                   // false => srsPages/boardTickets are unknown, not zero
//   }
//
// Output (stdout, JSON): see recap.sh
//
// Exit codes:
//   0 — recap emitted
//   1 — internal error
//   2 — invalid input

const fs = require('fs')

function bail(message) {
  process.stderr.write('recap: ' + message + '\n')
  process.exit(2)
}

const raw = fs.readFileSync(0, 'utf8')
if (!raw.trim()) bail('empty input on stdin')

let input
try {
  input = JSON.parse(raw)
} catch (err) {
  bail('invalid JSON on stdin: ' + err.message)
}
if (input === null || typeof input !== 'object' || Array.isArray(input)) {
  bail('input must be a JSON object with "signals"')
}

const signals = input.signals
if (!signals || typeof signals !== 'object' || Array.isArray(signals)) {
  bail('"signals" is required — recap reads state, it does not guess')
}

const network = input.network !== false
const status = input.status && typeof input.status === 'object' ? input.status : null
const preconditions = status && Array.isArray(status.preconditions) ? status.preconditions : []

const byName = new Map(preconditions.map((p) => [p.name, p]))

// Which precondition gates which phase. This is the whole of "a phase whose precondition
// fails routes to the install path": the remediation is already written on the
// precondition, so the flow only has to know which phase it belongs to.
const GATES = {
  3: 'manifest',
  4: 'srs',
  5: 'workflow'
}

const PHASES = [
  { n: 1, name: 'Read the POC', exit: 'a reading the user confirmed, and the POC filed into POC/', next: 'read-poc.sh <dir>, then plan-poc-move.sh and move-poc.sh --confirm' },
  { n: 2, name: 'Challenge the intent', exit: 'intake.json holding answers traced to observations', next: 'read-poc.sh POC | plan-challenge.sh, then record-intake.sh --out intake.json' },
  { n: 3, name: 'Decide the setup', exit: 'a project directory holding .saasfoundry.json', next: 'plan-new.sh, then run the sf new command it prints' },
  { n: 4, name: 'Write the SRS', exit: 'pages under the SRS root page', next: 'the sf-srs skill — write-srs, one feature first' },
  { n: 5, name: 'Create the tickets', exit: 'the board carries tickets', next: 'srs-cli.sh spawn against a version page' },
  { n: 6, name: 'Base setup', exit: 'the first ticket past Backlog', next: 'the sf-workflow skill, starting from the board' },
  { n: 7, name: 'Features', exit: null, next: 'the sf-workflow skill, one ticket at a time' }
]

// done | pending | unknown. `unknown` exists so that an offline recap never reports work as
// missing when it simply could not look — restarting a written SRS would be worse than
// saying "I could not check".
function completion(n) {
  if (n === 1) return signals.pocFiled === true ? 'done' : 'pending'
  if (n === 2) return typeof signals.intakeEntries === 'number' && signals.intakeEntries > 0 ? 'done' : 'pending'
  if (n === 3) return typeof signals.manifestPath === 'string' && signals.manifestPath ? 'done' : 'pending'
  if (n === 4) {
    if (!network || signals.srsPages === null || signals.srsPages === undefined) return 'unknown'
    return signals.srsPages > 0 ? 'done' : 'pending'
  }
  if (n === 5) {
    if (!network || signals.boardTickets === null || signals.boardTickets === undefined) return 'unknown'
    return signals.boardTickets > 0 ? 'done' : 'pending'
  }
  return 'pending'
}

// Not every project reaches the flow through a POC. When a manifest exists but neither a
// POC/ nor an intake record does, phases 1 and 2 never applied — the user entered at the
// setup, or arrived with an already-scaffolded project. Reporting them as "pending" would
// tell every existing project to go and read a POC it never had.
const enteredWithoutPoc =
  typeof signals.manifestPath === 'string' &&
  signals.manifestPath &&
  signals.pocFiled !== true &&
  !(typeof signals.intakeEntries === 'number' && signals.intakeEntries > 0)

// The guard above needs a manifest, so it protects a project AFTER `sf new` has run —
// the case that was already safe — and misses the window before it. That window is
// exactly where a `--profile harness` user starts: an existing project, no manifest yet.
// Reported as `pending`, phase 1 told them to run `move-poc.sh --confirm` on a codebase
// they intend to keep. On a POC that is the flow; on a live project it relocates
// everything they have, and the POC intake's own warning applies with full force — there
// is often no remote and no history to restore from.
//
// The discriminator is not on disk. It is the profile question the skill asks first:
// "does a codebase already exist here that you intend to keep?" So the honest state is
// `unknown` — the same answer already given for the SRS and the board offline. It stops
// the walk and routes to the question instead of guessing an answer that destroys work
// half the time.
const codeButNoDecisionYet =
  !(typeof signals.manifestPath === 'string' && signals.manifestPath) &&
  signals.pocFiled !== true &&
  !(typeof signals.intakeEntries === 'number' && signals.intakeEntries > 0) &&
  signals.workspaceOccupied === true

const PROFILE_QUESTION =
  'establish the profile first — "does a codebase already exist here that you intend to keep?" Yes → sf new --profile harness, and nothing moves. No, it is a throwaway POC → read-poc.sh, then the move.'

const phases = PHASES.map((phase) => {
  let state = completion(phase.n)
  if (phase.n <= 2) {
    if (enteredWithoutPoc) state = 'not-applicable'
    else if (codeButNoDecisionYet) state = 'unknown'
  }
  const gate = GATES[phase.n] ? byName.get(GATES[phase.n]) : undefined
  const blocked = gate && (gate.status === 'fail' || gate.status === 'warn')
  return {
    phase: phase.n,
    name: phase.name,
    state,
    exit: phase.exit,
    blockedBy: blocked ? { precondition: gate.name, status: gate.status, details: gate.details || null, remediation: gate.remediation || null } : null
  }
})

// The current phase is the first that is neither done nor out of scope. An `unknown` stops
// the walk too: we cannot claim to be past a phase we could not verify.
const current = phases.find((p) => p.state !== 'done' && p.state !== 'not-applicable') || phases[phases.length - 1]

const blockers = phases.filter((p) => p.blockedBy !== null && p.phase >= current.phase)

// A phase whose answer is a question must not print the command that assumes an answer.
const currentNext = codeButNoDecisionYet && current.phase <= 2 ? PROFILE_QUESTION : PHASES[current.phase - 1].next

const notes = []
if (!network) notes.push('run without network: phases 4 and 5 are reported as unknown, not as undone — do not restart work that may already exist')
if (codeButNoDecisionYet)
  notes.push(
    'this folder already holds code and has no manifest yet — whether it is a POC to file into POC/ or a project to keep is the profile question, not something readable from disk. Never propose the move before it is answered'
  )
if (enteredWithoutPoc) notes.push('a manifest exists but no POC was ever filed here — phases 1 and 2 did not apply to this project, they are not outstanding work')
if (!status) notes.push('no sf status payload was supplied, so no precondition could be checked — the phase is read from local signals alone')

process.stdout.write(
  JSON.stringify(
    {
      current: { phase: current.phase, name: current.name, state: current.state, next: currentNext },
      phases,
      blockers,
      network,
      notes
    },
    null,
    2
  ) + '\n'
)
