#!/usr/bin/env node
'use strict'

// Turns a read-poc report into grounded seeds for the challenge conversation.
//
// A seed is NOT a question. It is an observation plus the dimension that observation
// opens up, and the model turns it into the actual question. The split is the point:
// asking well is judgement, but "does this question come from something the code
// actually showed?" must not be, or the flow degrades into the generic intake it exists
// to replace — a list any project would get, answered vaguely, producing a specification
// that says nothing specific.
//
// So the model may refine a seed, merge two, or drop one. It may not invent one.
//
// Input (stdin, JSON): a read-poc report, or { "report": <read-poc report> }
//
// Output (stdout, JSON): see plan-challenge.sh
//
// Exit codes:
//   0 — seeds emitted (including revealing:false — that is a finding, not an error)
//   1 — internal error
//   2 — invalid input

const fs = require('fs')

const CAP = 6

function bail(message) {
  process.stderr.write('plan-challenge: ' + message + '\n')
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
  bail('input must be a JSON object')
}

const report = input.report && typeof input.report === 'object' ? input.report : input
if (!report.inventory || typeof report.inventory !== 'object') {
  bail('report.inventory is missing — the input does not look like a read-poc report')
}

const deps = (report.package && Array.isArray(report.package.dependencies) ? report.package.dependencies : []).map((d) => String(d).toLowerCase())
const stacks = Array.isArray(report.stacks) ? report.stacks : []
const topLevel = Array.isArray(report.inventory.topLevel) ? report.inventory.topLevel : []
const description = (report.package && report.package.description) || ''
const readmeProse = (report.readme && report.readme.firstParagraph) || ''

const has = (needles) => deps.some((d) => needles.some((n) => d === n || d.startsWith(n + '/') || d.startsWith(n)))

const DATABASE = ['pg', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3', 'prisma', '@prisma', 'mongoose', 'mongodb', 'sequelize', 'typeorm', 'drizzle-orm', 'knex', 'redis', 'ioredis']
const AUTH = ['passport', 'jsonwebtoken', 'next-auth', 'bcrypt', 'bcryptjs', 'argon2', '@auth', 'lucia', 'clerk', 'jose']
const HTTP = ['express', 'fastify', 'koa', 'hapi', '@nestjs', 'next', 'hono', 'restify', 'polka']
const CLOUD = ['aws-sdk', '@aws-sdk', '@google-cloud', '@azure', 'firebase-admin', '@supabase']
const LOCAL_MEDIA = ['onnxruntime-node', '@xenova', 'whisper', 'node-whisper', 'vosk', '@tensorflow', 'fluent-ffmpeg', '@ffmpeg', 'opencv4nodejs']

// A dependency list only exists for node today: read-poc parses package.json and no other
// manifest. Saying so beats letting a python POC look like one that revealed nothing.
const hasDependencyList = report.package !== null && report.package !== undefined
const notes = []
if (!hasDependencyList && stacks.length > 0) {
  notes.push('no dependency list was available for ' + stacks.join(' / ') + ' — the probes that read dependencies could not run, so this reading is thinner than it looks')
}

// Ordered most product-shaping first. The cap keeps this a conversation, so the order is
// what decides which questions actually get asked.
const RULES = [
  {
    dimension: 'what was actually proven',
    applies: () => /\b(prove[sd]?|proving|can we|whether|feasib|spike|experiment)\b/i.test(description + ' ' + readmeProse),
    observation: () => 'the POC describes itself as proving something: "' + (readmeProse || description).slice(0, 180) + '"',
    evidence: () => (readmeProse ? 'readme.firstParagraph' : 'package.description'),
    probe: 'is the thing it proved the product itself, or one component of a larger product? The answer decides whether the POC is a prototype of the whole or of a part.'
  },
  {
    dimension: 'privacy stance',
    applies: () => hasDependencyList && has(LOCAL_MEDIA),
    observation: () => 'processing runs locally rather than through an API — ' + deps.filter((d) => LOCAL_MEDIA.some((n) => d.startsWith(n))).join(', '),
    evidence: () => 'package.dependencies',
    probe: 'choosing local processing is already a privacy position. Was that deliberate and must it hold in the product, or was it just the quickest thing to get working?'
  },
  {
    dimension: 'persistence and multi-user',
    applies: () => hasDependencyList && !has(DATABASE),
    observation: () => 'no database or ORM among the dependencies — whatever state exists is in memory or in files',
    evidence: () => 'package.dependencies',
    probe: 'does more than one person ever use this at the same time, and does anything need to survive a restart? A POC that never had to answer that is not evidence that the product does not.'
  },
  {
    dimension: 'who the users are',
    applies: () => hasDependencyList && !has(AUTH),
    observation: () => 'nothing authenticates anyone — no auth or token library in the dependencies',
    evidence: () => 'package.dependencies',
    probe: 'are there distinct users with different rights, or one operator? This is the question that decides whether roles and permissions exist at all.'
  },
  {
    dimension: 'service or script',
    applies: () => hasDependencyList && Array.isArray(report.entryPoints) && report.entryPoints.length > 0 && !has(HTTP),
    observation: () => 'it starts at ' + report.entryPoints.join(', ') + ' with no HTTP framework in the dependencies',
    evidence: () => 'entryPoints + package.dependencies',
    probe: 'is this something a person runs when they need it, or something that stays up and is called? The product shape follows from that, not the other way round.'
  },
  {
    dimension: 'where it runs',
    applies: () => hasDependencyList && has(CLOUD),
    observation: () => 'it already talks to a cloud provider — ' + deps.filter((d) => CLOUD.some((n) => d.startsWith(n))).join(', '),
    evidence: () => 'package.dependencies',
    probe: 'is that provider a constraint you are keeping, and does the data have to sit anywhere in particular?'
  },
  {
    dimension: 'what has to be guaranteed',
    applies: () => report.tests && report.tests.present === false,
    observation: () => 'nothing in the POC is tested — no test directory and no spec files',
    evidence: () => 'tests.present',
    probe: 'which behaviour would be unacceptable to get wrong in the product? That is what earns a test first; the rest can follow.'
  },
  {
    dimension: 'which stack survives',
    applies: () => stacks.filter((s) => s !== 'docker').length > 1,
    observation: () => 'the POC mixes ' + stacks.join(' and ') + ' — ' + (report.manifests || []).join(', '),
    evidence: () => 'stacks + manifests',
    probe: 'which of those is the product written in, and which was scaffolding for the experiment?'
  },
  {
    dimension: 'how settled the shape is',
    applies: () => report.inventory.sourceFiles >= 3 && !topLevel.includes('src') && !topLevel.includes('lib') && !topLevel.includes('app'),
    observation: () => 'the source sits flat at the top level (' + topLevel.slice(0, 8).join(', ') + ') rather than under src/ or lib/',
    evidence: () => 'inventory.topLevel',
    probe: 'is the current shape something you want carried over, or was it never meant to survive the experiment?'
  }
]

let seeds = []
let considered = 0

if (report.recognisable !== false) {
  for (const rule of RULES) {
    let applies = false
    try {
      applies = Boolean(rule.applies())
    } catch {
      applies = false // a malformed report should thin the reading, never crash it
    }
    if (!applies) continue
    considered++
    seeds.push({
      dimension: rule.dimension,
      observation: rule.observation(),
      evidence: rule.evidence(),
      probe: rule.probe
    })
  }
}

const dropped = Math.max(0, seeds.length - CAP)
seeds = seeds.slice(0, CAP)

// The sibling of read-poc's `recognisable`. One seed is not a challenge, it is a single
// question dressed up as one — and a POC that reveals nothing deserves to be told so
// rather than padded out with questions any project would get.
let revealing = true
let reason = null
if (report.recognisable === false) {
  revealing = false
  reason = 'the POC could not be read (' + (report.reason || 'unrecognisable') + '), so nothing about it can be challenged'
} else if (seeds.length < 2) {
  revealing = false
  reason = 'the POC reveals too little to build a challenge from — ' + seeds.length + ' grounded observation(s) out of ' + RULES.length + ' probes'
}

process.stdout.write(
  JSON.stringify(
    {
      root: report.root || null,
      revealing,
      reason,
      seeds,
      cap: CAP,
      considered,
      dropped,
      notes
    },
    null,
    2
  ) + '\n'
)
