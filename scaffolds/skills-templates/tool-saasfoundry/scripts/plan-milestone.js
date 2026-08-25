#!/usr/bin/env node
'use strict'

// Proposes release milestones from what the board and the SRS already say.
//
// Two behaviours, and conflating them turns the feature into a nag:
//
//   1. SHOULD we propose defining one at all — a trigger, not a greeting. Firing on
//      every turn is how a guardrail gets ignored, and then disabled.
//   2. WHAT the milestones would be — candidates with their contents and, for each,
//      the evidence the grouping rests on.
//
// Same split as plan-challenge: the script decides what is groundable, the model writes
// the sentence. A candidate with no evidence is not emitted, so the model cannot present
// an invented grouping as a derived one.
//
// Input (stdin, JSON):
//   {
//     "tickets":    [{ "number": 536, "title": "...", "status": "Done", "isEpic": bool,
//                      "parent": 512|null, "milestone": "v1.0.0"|null }],
//     "milestones": [{ "title": "v1.0.0", "state": "open"|"closed" }],
//     "srsVersions":[{ "title": "v2 — ...", "url": "..." }]        // optional
//   }
//
// Every candidate carries both `scopeSize` (what the release would contain) and
// `openCount` (what is left to do). They answer different questions and the ranking uses
// the first — see the sort below.
//
// Output (stdout, JSON): see plan-milestone.sh
//
// Exit codes:
//   0 — emitted (including shouldPropose:false — a finding, not an error)
//   1 — internal error
//   2 — invalid input

const fs = require('fs')

const CAP = 3
// Below this, "you have some unassigned tickets" is noise: every board has a handful in
// flight. The trigger has to mean something the user would act on.
const UNASSIGNED_THRESHOLD = 8

function bail(message) {
  process.stderr.write('plan-milestone: ' + message + '\n')
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
  bail('input must be a JSON object with "tickets"')
}
if (!Array.isArray(input.tickets)) {
  bail('"tickets" must be an array — the proposal is derived from the board, not guessed')
}

const tickets = input.tickets.filter((t) => t && typeof t === 'object' && typeof t.number === 'number')
const milestones = Array.isArray(input.milestones) ? input.milestones : []
const srsVersions = Array.isArray(input.srsVersions) ? input.srsVersions : []

// A version already linked to a milestone is not an undeclared scope. Without this,
// a project mid-flight is told to re-declare what it declared last week, every turn.
// The link lives in the milestone description, where `milestone associate` writes it.
const associatedPages = milestones.map((m) => String((m && m.description) || '')).join('\n')
const unmilestonedVersions = srsVersions.filter((v) => {
  if (!v || typeof v.url !== 'string' || v.url.length === 0) return true
  return !associatedPages.includes(v.url)
})
const alreadyAssociated = srsVersions.length - unmilestonedVersions.length

const isDone = (t) => String(t.status || '').toLowerCase() === 'done'
const openTickets = tickets.filter((t) => !isDone(t))
const unassigned = openTickets.filter((t) => !t.milestone)
const openMilestones = milestones.filter((m) => m && m.state !== 'closed')

const byNumber = new Map(tickets.map((t) => [t.number, t]))

// ── candidates ──────────────────────────────────────────────────────────────────────
//
// Each strategy must name what it grouped on. A candidate whose evidence would read
// "these were left over" is still honest — but it says so, rather than dressing itself up.

const candidates = []

// 1. An open Epic with unfinished children is the most defensible release scope there is:
//    somebody already decided those tickets belong together.
for (const epic of tickets.filter((t) => t.isEpic && !isDone(t))) {
  const children = tickets.filter((t) => t.parent === epic.number)
  const openChildren = children.filter((t) => !isDone(t))
  if (openChildren.length === 0) continue
  candidates.push({
    source: 'epic',
    name: null, // the model proposes a release name; the script will not invent semver
    rationale: 'Epic #' + epic.number + ' holds ' + children.length + ' ticket' + (children.length === 1 ? '' : 's') + ', ' + openChildren.length + ' still open',
    evidence: 'grouped by sub-issue relationship to #' + epic.number + ' — "' + String(epic.title || '').slice(0, 80) + '"',
    tickets: children.map((t) => t.number),
    scopeSize: children.length,
    openCount: openChildren.length,
    doneCount: children.length - openChildren.length
  })
}

// 2. An SRS version page is a scope the product already declared. It is associated to a
//    release, never equal to it (#542 R2), so this proposes contents, not a name.
for (const version of unmilestonedVersions) {
  if (!version || typeof version.title !== 'string') continue
  const feature = typeof version.feature === 'string' && version.feature ? version.feature : null
  const frCount = typeof version.frCount === 'number' ? version.frCount : null
  candidates.push({
    source: 'srs-version',
    name: null,
    rationale:
      'the SRS declares a version: "' +
      version.title.slice(0, 80) +
      '"' +
      (feature ? ' under « ' + feature.slice(0, 60) + ' »' : '') +
      (frCount !== null ? ', ' + frCount + ' FR' + (frCount === 1 ? '' : 's') : ''),
    evidence: 'SRS version page' + (version.url ? ' ' + version.url : ''),
    tickets: [],
    // The FRs are on the SRS side, not the board — this scope is what the product
    // declared, not what has been spawned from it yet. Saying 0 would read as "empty".
    scopeSize: frCount !== null ? frCount : 0,
    openCount: 0,
    doneCount: 0
  })
}

// 3. Whatever is open, carries no milestone, and hangs off no open Epic. Naming it
//    "leftovers" rather than inventing a theme is the honest description.
const groupedNumbers = new Set(candidates.flatMap((c) => c.tickets))
const leftovers = unassigned.filter((t) => !groupedNumbers.has(t.number) && !t.isEpic && !(t.parent && byNumber.has(t.parent)))
if (leftovers.length >= 3) {
  candidates.push({
    source: 'unaffiliated',
    name: null,
    rationale: leftovers.length + ' open tickets belong to no Epic and no milestone',
    evidence: 'grouped only by being unaffiliated — this is a leftover set, not a theme',
    tickets: leftovers.map((t) => t.number),
    scopeSize: leftovers.length,
    openCount: leftovers.length,
    doneCount: 0
  })
}

// Ranked by how defensible the grouping is, then by how much it contains.
//
// Not by remaining work. `openCount` answers "where is there still work?", which is the
// right question when re-scoping mid-flight and the wrong one when framing a release: a
// milestone records what a release CONTAINS, and it is read mostly after the release,
// when everything in it is closed. Dogfooding made that plain — #482 holds 16 tickets
// with 15 done, the most complete release scope on this board, and ranking by remaining
// work put it last and then dropped it.
//
// Size alone is not enough either: it would float the unaffiliated pile to the top, which
// is the largest grouping and the least defensible one. So source first — the product
// declared a version, or somebody decided these tickets belong together, or they are
// simply what is left — and size within it. Both counts are emitted; the model picks the
// one its question needs.
const SOURCE_RANK = { 'srs-version': 0, epic: 1, unaffiliated: 2 }
candidates.sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || b.scopeSize - a.scopeSize)

const considered = candidates.length
const dropped = Math.max(0, considered - CAP)
const kept = candidates.slice(0, CAP)

// Naming what was cut, not just counting it. A cap that reports "2 more" reads as "nothing
// you care about"; the one you care about is exactly the one you cannot see. Found on the
// real board, where five Epics competed for three slots.
const droppedSummary = candidates.slice(CAP).map((c) => ({ source: c.source, rationale: c.rationale, scopeSize: c.scopeSize, openCount: c.openCount }))

// ── the trigger ─────────────────────────────────────────────────────────────────────

let shouldPropose = false
let trigger = null
let reason = null

if (kept.length === 0) {
  reason = tickets.length === 0 ? 'the board is empty — there is nothing to group' : 'nothing on the board groups into a release scope: no open Epic with unfinished children, no SRS version, and too few unaffiliated tickets'
} else if (openMilestones.length === 0 && unassigned.length >= UNASSIGNED_THRESHOLD) {
  shouldPropose = true
  trigger = unassigned.length + ' open tickets carry no milestone and none is open — the next release has no declared scope'
} else if (openMilestones.length === 0 && kept.some((c) => c.source === 'srs-version')) {
  shouldPropose = true
  trigger = 'the SRS declares a version that no milestone corresponds to'
} else {
  reason =
    openMilestones.length > 0
      ? 'a milestone is already open (' + openMilestones.map((m) => m.title).join(', ') + ') — re-scope it rather than proposing another'
      : 'only ' + unassigned.length + ' open ticket(s) carry no milestone, which is below the threshold worth interrupting for'
}

const notes = []
// A truncated board makes every count below an undercount, so it is said first and in
// those terms — not as a footnote about pagination.
if (input.boardTruncated === true) {
  notes.push('the board was read up to ' + (input.boardLimit || 'the limit') + ' items and hit that limit — every count here is a floor, and a grouping may be missing tickets entirely')
}
if (dropped > 0) {
  notes.push(dropped + ' further candidate(s) did not fit the cap — they are listed in `droppedCandidates`, not hidden')
}
// The old note said "no SRS versions were supplied" on every single run, describing a
// gap the script could close itself. Now it distinguishes the three real cases.
if (input.srsUnreachable === true) {
  notes.push('the SRS could not be read, so nothing could be grouped by what the product declared — this is a gap in the evidence, not a finding that no version exists')
} else if (srsVersions.length === 0) {
  notes.push('the SRS declares no version pages, so grouping rests on the board alone — `sf srs normalize` is what puts features onto the version model')
} else if (unmilestonedVersions.length === 0) {
  notes.push('every version the SRS declares (' + srsVersions.length + ') already belongs to a milestone')
} else if (alreadyAssociated > 0) {
  notes.push(alreadyAssociated + ' version(s) already belong to a milestone and were not proposed again')
}

process.stdout.write(
  JSON.stringify(
    {
      shouldPropose,
      trigger,
      reason,
      candidates: kept,
      droppedCandidates: droppedSummary,
      cap: CAP,
      considered,
      dropped,
      counts: { tickets: tickets.length, open: openTickets.length, unassigned: unassigned.length, openMilestones: openMilestones.length },
      notes
    },
    null,
    2
  ) + '\n'
)
