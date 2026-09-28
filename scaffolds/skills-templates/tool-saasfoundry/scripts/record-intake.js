#!/usr/bin/env node
'use strict'

// Validates the challenge conversation into the intake record the SRS step consumes.
//
// The one rule it enforces: an answer must reference a seed. "Every question names the
// observation it comes from" is easy to honour while asking and easy to lose by the time
// anything is written down — and a record with an unsourced answer in it is precisely the
// generic intake this flow replaces, only harder to spot because it looks specific.
//
// So the link is checked here, at the moment the conversation becomes an artefact.
//
// Input (stdin, JSON):
//   {
//     "seeds":  [<plan-challenge seeds>],
//     "answers": [{ "dimension": "...", "question": "...", "answer": "..." }],
//     "root":   "<poc path>",     // optional, carried through
//     "notes":  [string]          // optional, carried through
//   }
//
// Output (stdout, JSON): the intake record
//
// Exit codes:
//   0 — record emitted
//   1 — internal error
//   2 — invalid input, or an answer that references no seed

const fs = require('fs')

function bail(message) {
  process.stderr.write('record-intake: ' + message + '\n')
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
  bail('input must be a JSON object with "seeds" and "answers"')
}

const seeds = input.seeds
if (!Array.isArray(seeds)) bail('"seeds" must be the array from plan-challenge')
for (const seed of seeds) {
  if (!seed || typeof seed !== 'object' || typeof seed.dimension !== 'string' || typeof seed.observation !== 'string') {
    bail('every seed needs a "dimension" and an "observation" — pass plan-challenge output through unchanged')
  }
}

const answers = input.answers === undefined ? [] : input.answers
if (!Array.isArray(answers)) bail('"answers" must be an array')

const byDimension = new Map(seeds.map((s) => [s.dimension, s]))

const entries = []
const seen = new Set()

for (const [index, answer] of answers.entries()) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    bail('answers[' + index + '] must be an object with dimension, question and answer')
  }
  const { dimension, question, answer: text } = answer

  if (typeof dimension !== 'string' || !dimension.trim()) {
    bail('answers[' + index + '] has no "dimension" — it cannot be traced back to an observation')
  }

  // The refusal that carries the acceptance criterion.
  if (!byDimension.has(dimension)) {
    process.stderr.write('record-intake: answers[' + index + '] references "' + dimension + '", which is not one of the seeds.\n')
    process.stderr.write('record-intake: every recorded answer must trace back to something the POC actually showed.\n')
    process.stderr.write('record-intake: seeded dimensions are: ' + (seeds.length ? seeds.map((s) => '"' + s.dimension + '"').join(', ') : '(none)') + '\n')
    process.stderr.write('record-intake: if this came up outside the challenge, it belongs in the SRS conversation, not in the intake record.\n')
    process.exit(2)
  }

  if (typeof question !== 'string' || !question.trim()) {
    bail('answers[' + index + '] ("' + dimension + '") has no "question" — record what was actually asked, not just the seed')
  }
  if (typeof text !== 'string' || !text.trim()) {
    bail('answers[' + index + '] ("' + dimension + '") has no "answer" — leave it out entirely rather than recording an empty one')
  }
  if (seen.has(dimension)) {
    bail('answers[' + index + '] answers "' + dimension + '" twice')
  }
  seen.add(dimension)

  const seed = byDimension.get(dimension)
  entries.push({
    dimension,
    observation: seed.observation,
    evidence: seed.evidence || null,
    question: question.trim(),
    answer: text.trim()
  })
}

const unanswered = seeds.filter((s) => !seen.has(s.dimension)).map((s) => s.dimension)

process.stdout.write(
  JSON.stringify(
    {
      version: 1,
      root: typeof input.root === 'string' ? input.root : null,
      entries,
      unanswered,
      notes: Array.isArray(input.notes) ? input.notes : []
    },
    null,
    2
  ) + '\n'
)
