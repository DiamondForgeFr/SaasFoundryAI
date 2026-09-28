import { CategoryScore, FreshnessReport } from './types'

function formatScore(score: number | null): string {
  if (score === null) return 'n/a'
  return `${score}%`
}

function formatCategory(label: string, score: CategoryScore): string {
  const header = `  ${label.padEnd(4)} ${formatScore(score.score).padStart(5)}  (${score.covered}/${score.total})`
  if (score.note) return `${header}\n       ${score.note}`
  return header
}

export function formatHumanReport(report: FreshnessReport): string {
  const lines: string[] = []
  lines.push('─── SRS freshness report ───')
  lines.push(`Root page   : ${report.rootPageId}`)
  lines.push(`Generated   : ${report.generatedAt}`)
  lines.push(`Threshold   : ${report.thresholdPct}% (status = ${report.overall.status.toUpperCase()})`)
  lines.push(`Overall     : ${report.overall.score}%`)
  lines.push('')
  lines.push('Per category:')
  lines.push(formatCategory('UR', report.categories.UR))
  lines.push(formatCategory('FR', report.categories.FR))
  lines.push(formatCategory('DS', report.categories.DS))
  lines.push(formatCategory('TC', report.categories.TC))
  lines.push(formatCategory('NFR', report.categories.NFR))
  lines.push('')
  lines.push('Counts:')
  lines.push(`  FR pages       : ${report.counts.frTotal} (matched ${report.counts.frMatched}, untested ${report.counts.frUntested})`)
  lines.push(`  Endpoints      : ${report.counts.endpointsTotal} (matched ${report.counts.endpointsMatched}, untested ${report.counts.endpointsUntested})`)
  lines.push('')
  if (report.findings.length === 0) {
    lines.push('No drift findings.')
  } else {
    lines.push(`Drift findings (${report.findings.length}):`)
    for (const f of report.findings) {
      const marker = f.severity === 'error' ? '✗' : f.severity === 'warn' ? '!' : '·'
      const ref = f.file ? ` — ${f.file}` : ''
      lines.push(`  ${marker} [${f.kind}] ${f.message}${ref}`)
    }
  }
  return lines.join('\n') + '\n'
}

export function formatJsonReport(report: FreshnessReport): string {
  return JSON.stringify(report, null, 2) + '\n'
}
