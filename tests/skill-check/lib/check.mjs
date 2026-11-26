import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'

import { dataDir, readJson, squash } from './util.mjs'
import { blocks, buildView, leadOf, loadSkills, markdownFiles, measureView, relativeLinks, splitRegion } from './views.mjs'

/**
 * Layer 1: the rule ledger. No model, no network, no build: it reads the skill files and three data files
 * (`skills.json`, `ledger/<skill>.json`, `budgets.json`) and says which promise a change broke.
 *
 * A failure is `{ code, skill, view, subject, message }`. The codes:
 *
 *   TOKEN_MISSING        a ledgered rule lost one of its tokens in the file that owns it
 *   TOKEN_DUPLICATED     a rule marked `unique` has a token in another file of the skill
 *   OWNER_MISSING        the file that owns a rule is not in the view
 *   REGION_MISSING       a rule names a region of an instructions file that has no markers
 *   TIER_MISPLACED       a disclosed rule is owned by the entry file
 *   POINTER_MISSING      nothing in the pointer's file names the disclosed file
 *   POINTER_NOT_LEADING  the pointer does not open with the trigger the ledger records
 *   LINK_BROKEN          a relative link resolves to nothing
 *   KNOWN_LINK_FIXED     a link the ledger lists as broken works now: remove the entry
 *   CEILING_EXCEEDED     a surface is larger than its byte ceiling
 *   CEILING_MISSING      a surface has no ceiling: run `metrics --write-budgets`
 *   CEILING_STALE        a ceiling names a file the surface no longer has
 *   LEDGER_MISSING       a skill has no ledger
 *   LEDGER_UNKNOWN       a ledger names a skill `skills.json` does not know
 *   VIEW_MISSING         a view's root does not exist
 *   VIEW_UNKNOWN         a rule names a view the skill does not declare
 *   RETIRED_NO_REASON    a retired rule gives no reason
 */
export function runCheck(root, { only } = {}) {
  const dir = dataDir(root)
  const skillsDoc = loadSkills(root)
  const budgets = readJson(join(dir, 'budgets.json'))
  const ledgers = loadLedgers(dir)
  const failures = []
  const stats = { skills: 0, views: 0, rules: 0, retired: 0, tokens: 0, links: 0, ceilings: 0 }
  const fail = (code, skill, view, subject, message) => failures.push({ code, skill, view, subject, message })

  for (const skill of Object.keys(ledgers)) {
    if (!skillsDoc.skills[skill]) fail('LEDGER_UNKNOWN', skill, '-', `ledger/${skill}.json`, 'no such skill in skills.json')
  }

  for (const [skill, def] of Object.entries(skillsDoc.skills)) {
    if (only && !only.includes(skill)) continue
    stats.skills += 1
    const views = {}
    for (const [viewId, spec] of Object.entries(def.views)) {
      const view = buildView(root, spec)
      if (!view) {
        fail('VIEW_MISSING', skill, viewId, spec.root, `the root of this view does not exist: ${spec.root}`)
        continue
      }
      views[viewId] = view
      stats.views += 1
    }

    const ledger = ledgers[skill]
    if (!ledger) fail('LEDGER_MISSING', skill, '-', `ledger/${skill}.json`, 'every skill needs a ledger, even an empty one')
    else {
      checkRules({ skill, def, ledger, views, fail, stats })
      if (def.links !== false) checkLinks({ skill, ledger, views, fail, stats })
    }
    checkCeilings({ skill, def, budgets, views, fail, stats })
  }
  return { ok: failures.length === 0, failures, stats }
}

function loadLedgers(dir) {
  const ledgers = {}
  const ledgerDir = join(dir, 'ledger')
  if (!existsSync(ledgerDir)) return ledgers
  for (const name of readdirSync(ledgerDir).sort()) {
    if (!name.endsWith('.json')) continue
    const doc = readJson(join(ledgerDir, name))
    ledgers[doc.skill] = doc
  }
  return ledgers
}

function checkRules({ skill, def, ledger, views, fail, stats }) {
  for (const rule of ledger.rules) {
    if (rule.retired) {
      stats.retired += 1
      if (!rule.retired.reason) fail('RETIRED_NO_REASON', skill, '-', rule.id, 'a retired rule says why it is gone')
      continue
    }
    stats.rules += 1
    for (const viewId of rule.views ?? def.ledgerViews) {
      const view = views[viewId]
      if (!view) {
        if (!def.views[viewId]) fail('VIEW_UNKNOWN', skill, viewId, rule.id, `the skill declares no view ${viewId}`)
        continue
      }
      const ownerPath = view.files.get(rule.owner)
      if (!ownerPath) {
        fail('OWNER_MISSING', skill, viewId, rule.id, `${rule.owner} is not in this view, and it owns this rule`)
        continue
      }
      let text = readFileSync(ownerPath, 'utf8')
      if (rule.region) {
        const split = splitRegion(text)
        if (!split) {
          fail('REGION_MISSING', skill, viewId, rule.id, `${rule.owner} has no generated region`)
          continue
        }
        text = rule.region === 'generated' ? split.region : split.handWritten
      }
      const haystack = squash(text)
      for (const token of rule.tokens) {
        stats.tokens += 1
        if (!haystack.includes(squash(token))) fail('TOKEN_MISSING', skill, viewId, rule.id, `${rule.owner} no longer holds ${JSON.stringify(token)}`)
      }
      if (rule.unique) {
        for (const [path, abs] of markdownFiles(view)) {
          if (path === rule.owner) continue
          const other = squash(readFileSync(abs, 'utf8'))
          for (const token of rule.tokens) {
            if (other.includes(squash(token))) fail('TOKEN_DUPLICATED', skill, viewId, rule.id, `${path} repeats ${JSON.stringify(token)}, which only ${rule.owner} may hold`)
          }
        }
      }
      if (rule.tier === 'disclosed') checkPointer({ skill, def, rule, view, viewId, fail })
    }
  }
}

function checkPointer({ skill, def, rule, view, viewId, fail }) {
  if (rule.owner === def.entry) {
    fail('TIER_MISPLACED', skill, viewId, rule.id, `a disclosed rule cannot be owned by the entry file ${def.entry}`)
    return
  }
  const from = rule.pointer?.from ?? def.entry
  const match = squash(rule.pointer?.match ?? rule.owner)
  const fromPath = view.files.get(from)
  if (!fromPath) {
    fail('POINTER_MISSING', skill, viewId, rule.id, `${from} is not in this view, and it should point at ${rule.owner}`)
    return
  }
  const naming = blocks(readFileSync(fromPath, 'utf8')).filter((block) => squash(block).includes(match))
  if (naming.length === 0) {
    fail('POINTER_MISSING', skill, viewId, rule.id, `${from} names no ${match}: a reader never reaches the rule`)
    return
  }
  const lead = rule.pointer?.lead
  if (lead && !naming.some((block) => squash(leadOf(block)).toLowerCase().startsWith(squash(lead).toLowerCase()))) {
    fail('POINTER_NOT_LEADING', skill, viewId, rule.id, `no pointer to ${match} in ${from} opens with ${JSON.stringify(lead)}`)
  }
}

function checkLinks({ skill, ledger, views, fail, stats }) {
  const known = (ledger.knownBrokenLinks ?? []).map((entry) => ({ ...entry, seen: false }))
  for (const [viewId, view] of Object.entries(views)) {
    if (view.spec.links === false) continue
    for (const [path, abs] of markdownFiles(view)) {
      for (const { target, path: linkPath } of relativeLinks(readFileSync(abs, 'utf8'))) {
        stats.links += 1
        const joined = posix.normalize(posix.join(posix.dirname(path), linkPath)).replace(/\/$/, '')
        let found
        if (!joined.startsWith('..')) found = view.files.has(joined) || view.dirs.has(joined)
        else if (view.spec.externalLinks === 'skip') continue
        else found = existsSync(resolve(view.base, posix.join(posix.dirname(path), linkPath)))
        if (found) continue
        const entry = known.find((item) => item.view === viewId && item.file === path && item.target === target)
        if (entry) entry.seen = true
        else fail('LINK_BROKEN', skill, viewId, path, `${target} resolves to nothing`)
      }
    }
  }
  for (const entry of known) {
    if (!entry.seen) fail('KNOWN_LINK_FIXED', skill, entry.view, entry.file, `${entry.target} works now: remove it from knownBrokenLinks`)
  }
}

function checkCeilings({ skill, def, budgets, views, fail, stats }) {
  const ceilings = budgets.ceilings[skill] ?? {}
  for (const [viewId, view] of Object.entries(views)) {
    const ceiling = ceilings[viewId]
    if (!ceiling) {
      fail('CEILING_MISSING', skill, viewId, '-', 'no byte ceiling for this surface: run `node tests/skill-check/run.mjs metrics --write-budgets`')
      continue
    }
    const measured = measureView(view, def.entry)
    const compare = (subject, actual, max) => {
      stats.ceilings += 1
      if (actual > max) fail('CEILING_EXCEEDED', skill, viewId, subject, `${actual} bytes, ceiling ${max} (${actual - max} over)`)
    }
    compare(`${def.entry} (entry)`, measured.entry.bytes, ceiling.entry)
    compare('all Markdown files', measured.total.bytes, ceiling.total)
    for (const [file, max] of Object.entries(ceiling.files ?? {})) {
      if (!measured.files[file]) fail('CEILING_STALE', skill, viewId, file, 'the surface no longer has this file: drop its ceiling')
      else compare(file, measured.files[file].bytes, max)
    }
    for (const [name, max] of Object.entries(ceiling.extra ?? {})) {
      if (measured.extra?.[name] === undefined) fail('CEILING_STALE', skill, viewId, name, 'the surface no longer measures this part')
      else compare(name, measured.extra[name], max)
    }
  }
}
