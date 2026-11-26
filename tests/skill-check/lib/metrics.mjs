import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { ceilKb, dataDir, fmt, formatJson, readJson } from './util.mjs'
import { buildView, loadSkills, measureView } from './views.mjs'

/** A file this size or larger gets a ceiling of its own, next to the entry and the whole. */
const FILE_CEILING_FROM = 4096

/** Bytes and lines of every surface of every skill: `{ skill: { view: { entry, total, files, extra? } } }`. */
export function measureAll(root, { only } = {}) {
  const out = {}
  for (const [skill, def] of Object.entries(loadSkills(root).skills)) {
    if (only && !only.includes(skill)) continue
    out[skill] = {}
    for (const [viewId, spec] of Object.entries(def.views)) {
      const view = buildView(root, spec)
      if (view) out[skill][viewId] = measureView(view, def.entry)
    }
  }
  return out
}

export function renderTable(measures) {
  const rows = [['skill', 'surface', 'entry bytes', 'entry lines', 'total bytes', 'total lines', 'md files']]
  for (const [skill, views] of Object.entries(measures)) {
    for (const [viewId, m] of Object.entries(views)) {
      rows.push([skill, viewId, fmt(m.entry.bytes), fmt(m.entry.lines), fmt(m.total.bytes), fmt(m.total.lines), String(Object.keys(m.files).length)])
      if (m.extra) rows.push(['', `  ${viewId} parts`, `region ${fmt(m.extra.region)}`, '', `hand-written ${fmt(m.extra.handWritten)}`, '', ''])
    }
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)))
  const line = (row) => row.map((cell, i) => (i < 2 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ')
  return [line(rows[0]), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.slice(1).map(line)].join('\n')
}

/**
 * The ceilings a measurement implies: every figure rounded up to the next KB. A ceiling that already exists
 * only goes down (a ratchet), unless `allowRaise` says a change meant to raise it. Files under 4 KiB share
 * the ceiling of the whole.
 */
export function ceilingsFrom(measures, existing = {}, { allowRaise = false } = {}) {
  const pick = (current, measured) => (current === undefined || allowRaise ? ceilKb(measured) : Math.min(current, ceilKb(measured)))
  const out = {}
  for (const [skill, views] of Object.entries(measures)) {
    out[skill] = {}
    for (const [viewId, m] of Object.entries(views)) {
      const old = existing[skill]?.[viewId] ?? {}
      const entry = {
        entry: pick(old.entry, m.entry.bytes),
        total: pick(old.total, m.total.bytes)
      }
      const files = {}
      for (const [file, size] of Object.entries(m.files)) {
        if (size.bytes >= FILE_CEILING_FROM || old.files?.[file] !== undefined) files[file] = pick(old.files?.[file], size.bytes)
      }
      if (Object.keys(files).length > 0) entry.files = files
      if (m.extra) entry.extra = Object.fromEntries(Object.entries(m.extra).map(([name, bytes]) => [name, pick(old.extra?.[name], bytes)]))
      out[skill][viewId] = entry
    }
  }
  return out
}

/** The commit the figures were taken on: the merge base with the working branch when there is one. */
export function baselineCommit(root, base = 'origin/develop') {
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  const mergeBase = git(['merge-base', 'HEAD', base])
  const result = mergeBase.status === 0 ? mergeBase : git(['rev-parse', 'HEAD'])
  return result.stdout.trim()
}

export function writeBudgets(root, measures, { allowRaise = false, partial = false, commit, date } = {}) {
  const path = join(dataDir(root), 'budgets.json')
  const existing = existsSync(path) ? readJson(path) : { ceilings: {} }
  const computed = ceilingsFrom(measures, existing.ceilings, { allowRaise })
  const doc = {
    kind: 'budgets',
    schemaVersion: 1,
    unit: 'bytes',
    roundTo: 1024,
    measuredAt: { commit: commit ?? existing.measuredAt?.commit, date: date ?? existing.measuredAt?.date },
    // A run limited to some skills (`--only`) leaves the ceilings of the others as they are.
    ceilings: partial ? { ...existing.ceilings, ...computed } : computed
  }
  writeFileSync(path, `${formatJson(doc)}\n`)
  const prettier = resolve(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs')
  if (existsSync(prettier)) spawnSync(process.execPath, [prettier, '--write', path], { cwd: root, stdio: 'ignore' })
  return path
}

/** Same sizes for the generated projects: the sf-workflow skill of each preset, the instructions chain of a monorepo. */
export function measureGenerated(fixtureDirs) {
  const out = {}
  const sizeOf = (path) => (existsSync(path) ? readFileSync(path).length : undefined)
  for (const [id, dir] of Object.entries(fixtureDirs)) {
    const entry = { instructions: sizeOf(join(dir, 'AGENTS.md')) }
    for (const surface of ['.claude/skills', '.agents/skills']) {
      for (const skill of ['sf-workflow', 'sf-srs', 'sf-tool-github-projects', 'sf-integration-rules', 'tool-saasfoundry']) {
        const skillDir = join(dir, surface, skill)
        if (!existsSync(skillDir)) continue
        const view = buildView(dir, { root: join(surface, skill) })
        const m = measureView(view, 'SKILL.md')
        entry[`${surface}/${skill}`] = { entryBytes: m.entry.bytes, totalBytes: m.total.bytes, mdFiles: Object.keys(m.files).length }
      }
    }
    for (const app of ['api', 'web']) {
      const appBytes = sizeOf(join(dir, 'apps', app, 'AGENTS.md'))
      if (appBytes !== undefined && entry.instructions !== undefined) entry[`chain:apps/${app}`] = entry.instructions + appBytes
    }
    out[id] = entry
  }
  return out
}
