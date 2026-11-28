import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import { MACHINE_PATH } from './privacy.mjs'
import { DEFAULT_ROOT, UsageError, dataDir, readJson } from './util.mjs'

/** The files of the check, by where they live: [path under tests/skill-check, definition in schema.json]. */
const SINGLES = [
  ['skills.json', 'skills'],
  ['budgets.json', 'budgets'],
  ['replay.json', 'replay'],
  ['fixtures.json', 'fixtures']
]
const FOLDERS = [
  ['ledger', 'ledger'],
  ['scenarios', 'scenarios']
]
const BASELINES = { results: 'results', metrics: 'metrics' }

/** Scenario groups that are not a skill with files to size: the checks of this repository's own conventions. */
const EXTRA_GROUPS = ['dogfood']

/** `ajv` is a dev dependency of this repository: it is resolved from the root under check, then from the checkout this file belongs to. */
async function loadAjv(root) {
  for (const base of [resolve(root), DEFAULT_ROOT]) {
    try {
      const Ajv = createRequire(join(base, 'package.json'))('ajv')
      return Ajv.default ?? Ajv
    } catch {
      // try the next base
    }
  }
  throw new UsageError('`validate` needs the dev dependencies: run `npm ci`')
}

/** Schema errors of every data file, then the cross-file promises a schema cannot state. Returns the problems, empty when all is well. */
export async function validateData(root) {
  const dir = dataDir(root)
  const Ajv = await loadAjv(root)
  const schema = readJson(join(dir, 'schema.json'))
  const ajv = new Ajv({ allErrors: true, strict: true })
  ajv.addSchema(schema)
  const problems = []
  const validate = (file, definition) => {
    const check = ajv.getSchema(`${schema.$id}#/definitions/${definition}`)
    const doc = readJson(join(dir, file))
    if (!check(doc)) for (const error of check.errors) problems.push(`${file}: ${error.instancePath || '/'} ${error.message}${error.params ? ` ${JSON.stringify(error.params)}` : ''}`)
    return doc
  }

  const docs = {}
  for (const [file, definition] of SINGLES) docs[file] = validate(file, definition)
  for (const [folder, definition] of FOLDERS) {
    for (const name of readdirSync(join(dir, folder)).sort()) if (name.endsWith('.json')) docs[`${folder}/${name}`] = validate(`${folder}/${name}`, definition)
  }
  const baselineDir = join(dir, 'baseline')
  if (existsSync(baselineDir)) {
    for (const name of readdirSync(baselineDir).sort()) {
      if (!name.endsWith('.json')) continue
      const kind = readJson(join(baselineDir, name)).kind
      if (!BASELINES[kind]) problems.push(`baseline/${name}: kind ${JSON.stringify(kind)} is neither results nor metrics`)
      else validate(`baseline/${name}`, BASELINES[kind])
      // This repository is public: a recorded file never holds a path of the machine it ran on (#1360). `run.mjs redact` rewrites one.
      const leak = readFileSync(join(baselineDir, name), 'utf8').match(MACHINE_PATH)
      if (leak) problems.push(`baseline/${name}: holds an absolute path of a machine (${leak[0]}…): rewrite it with \`run.mjs redact\``)
    }
  }
  if (problems.length > 0) return problems

  const skills = docs['skills.json'].skills
  const fixtures = docs['fixtures.json'].fixtures
  const ids = new Set()
  const ruleIds = new Set()
  const skillsWithScenarios = new Map()
  for (const [file, doc] of Object.entries(docs)) {
    if (doc.kind === 'scenarios') {
      if (!skills[doc.skill] && !EXTRA_GROUPS.includes(doc.skill)) problems.push(`${file}: skill ${doc.skill} is not in skills.json`)
      for (const scenario of doc.scenarios) {
        if (ids.has(scenario.id)) problems.push(`${file}: scenario id ${scenario.id} is used twice`)
        ids.add(scenario.id)
        if (!fixtures[scenario.fixture]) problems.push(`${file}: ${scenario.id} names fixture ${scenario.fixture}, which fixtures.json does not declare`)
        const entry = skillsWithScenarios.get(doc.skill) ?? { total: 0, core: 0 }
        entry.total += 1
        if (scenario.core) entry.core += 1
        skillsWithScenarios.set(doc.skill, entry)
      }
    }
    if (doc.kind === 'ledger') {
      if (!skills[doc.skill]) problems.push(`${file}: skill ${doc.skill} is not in skills.json`)
      for (const rule of doc.rules) {
        const key = `${doc.skill}/${rule.id}`
        if (ruleIds.has(key)) problems.push(`${file}: rule id ${rule.id} is used twice`)
        ruleIds.add(key)
        if (rule.tier === 'disclosed' && !rule.retired && !rule.pointer) problems.push(`${file}: ${rule.id} is disclosed and declares no pointer`)
        for (const view of rule.views ?? []) if (skills[doc.skill] && !skills[doc.skill].views[view]) problems.push(`${file}: ${rule.id} names view ${view}, which ${doc.skill} does not declare`)
      }
    }
  }
  for (const skill of Object.keys(skills)) {
    const found = skillsWithScenarios.get(skill)
    if (!found) problems.push(`skills.json: ${skill} has no scenario`)
    else if (found.core === 0) problems.push(`skills.json: ${skill} has no core scenario`)
    if (!docs[`ledger/${skill}.json`]) problems.push(`skills.json: ${skill} has no ledger/${skill}.json`)
    if (!docs['budgets.json'].ceilings[skill]) problems.push(`budgets.json: ${skill} has no ceilings`)
  }
  return problems
}
