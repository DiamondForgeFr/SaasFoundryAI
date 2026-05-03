import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Calibration harness for the SRS intent-detector classifier (#317).
// Two layers of metrics:
//
//   1. Per-signal accuracy — does the classifier put the prompt in the right
//      bucket (ur/fr/ds/tc/revision/trivial/none)?
//   2. Fire-rate metrics — given the hook's fire rule (signal in
//      {ur,fr,ds,tc,revision} AND confidence != "low"), how often do we
//      correctly fire (precision) and how often do we catch real SRS intent
//      (recall)?
//
// The pins (precision ≥ 0.85, recall ≥ 0.70) come from the spec on #317:
// "better to miss than to spam." If anyone tightens / loosens the regex
// rules in detect-eval-signals.sh, this guard will surface the trade-off
// instead of letting it land silently.

interface DatasetEntry {
  id: string
  prompt: string
  locale: 'en' | 'fr'
  expected_signal: 'ur' | 'fr' | 'ds' | 'tc' | 'revision' | 'trivial' | 'none'
  expected_should_fire: boolean
  notes?: string
}

const CLASSIFIER = path.resolve(__dirname, '../../../../.claude/skills/sf-srs/scripts/detect-eval-signals.sh')
const DATASET = path.resolve(__dirname, '../../../../.claude/skills/sf-srs/eval-datasets/intent-detector.jsonl')

function loadDataset(): DatasetEntry[] {
  const raw = readFileSync(DATASET, 'utf8')
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as DatasetEntry)
}

interface Classification {
  signal: DatasetEntry['expected_signal']
  confidence: 'low' | 'medium'
  target: string
}

function classify(prompt: string): Classification {
  const stdout = execFileSync('/bin/bash', [CLASSIFIER, '--classify', prompt], { encoding: 'utf8' })
  return JSON.parse(stdout) as Classification
}

function shouldFire(c: Classification): boolean {
  const firing = ['ur', 'fr', 'ds', 'tc', 'revision'] as const
  if (!firing.includes(c.signal as (typeof firing)[number])) return false
  if (c.confidence === 'low') return false
  return true
}

interface Metrics {
  truePositives: number
  falsePositives: number
  trueNegatives: number
  falseNegatives: number
  precision: number
  recall: number
  f1: number
}

function score(predictions: { entry: DatasetEntry; fired: boolean }[]): Metrics {
  let tp = 0
  let fp = 0
  let tn = 0
  let fn = 0
  for (const p of predictions) {
    if (p.fired && p.entry.expected_should_fire) tp++
    else if (p.fired && !p.entry.expected_should_fire) fp++
    else if (!p.fired && !p.entry.expected_should_fire) tn++
    else fn++
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn, precision, recall, f1 }
}

describe('SRS intent-detector calibration (#317)', () => {
  const dataset = loadDataset()

  it('dataset covers ≥ 50 prompts', () => {
    expect(dataset.length).toBeGreaterThanOrEqual(50)
  })

  it('dataset covers both locales', () => {
    const locales = new Set(dataset.map((e) => e.locale))
    expect(locales.has('en')).toBe(true)
    expect(locales.has('fr')).toBe(true)
  })

  it('dataset covers all expected_signal classes', () => {
    const signals = new Set(dataset.map((e) => e.expected_signal))
    for (const required of ['ur', 'fr', 'ds', 'tc', 'revision', 'trivial', 'none']) {
      expect(signals.has(required as DatasetEntry['expected_signal'])).toBe(true)
    }
  })

  it('dataset has both fire and no-fire labels', () => {
    expect(dataset.some((e) => e.expected_should_fire)).toBe(true)
    expect(dataset.some((e) => !e.expected_should_fire)).toBe(true)
  })

  describe('classifier behaviour', () => {
    const predictions = dataset.map((entry) => {
      const c = classify(entry.prompt)
      return { entry, classification: c, fired: shouldFire(c) }
    })

    it('precision ≥ 0.85 — when the hook fires, it is right at least 85% of the time', () => {
      const m = score(predictions)
      printSummary(m, predictions)
      expect(m.precision).toBeGreaterThanOrEqual(0.85)
    })

    it('recall ≥ 0.70 — at least 70% of real SRS-intent prompts trigger the hook', () => {
      const m = score(predictions)
      expect(m.recall).toBeGreaterThanOrEqual(0.7)
    })

    it('emits valid JSON for every prompt (degradation guard)', () => {
      for (const p of predictions) {
        expect(p.classification).toHaveProperty('signal')
        expect(p.classification).toHaveProperty('confidence')
      }
    })
  })
})

let summaryPrinted = false
function printSummary(m: Metrics, predictions: { entry: DatasetEntry; fired: boolean }[]): void {
  if (summaryPrinted) return
  summaryPrinted = true
  const total = predictions.length
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `SRS intent-detector calibration — ${total} prompts`,
      `  precision  : ${m.precision.toFixed(3)}  (TP=${m.truePositives}, FP=${m.falsePositives})`,
      `  recall     : ${m.recall.toFixed(3)}  (FN=${m.falseNegatives}, TN=${m.trueNegatives})`,
      `  f1         : ${m.f1.toFixed(3)}`,
      ''
    ].join('\n')
  )
  const misfires = predictions.filter((p) => p.fired && !p.entry.expected_should_fire)
  const misses = predictions.filter((p) => !p.fired && p.entry.expected_should_fire)
  if (misfires.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`  False positives (${misfires.length}):`)
    for (const m of misfires) {
      // eslint-disable-next-line no-console
      console.log(`    [${m.entry.id}] "${m.entry.prompt}"`)
    }
  }
  if (misses.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`  False negatives (${misses.length}):`)
    for (const m of misses) {
      // eslint-disable-next-line no-console
      console.log(`    [${m.entry.id}] "${m.entry.prompt}"`)
    }
  }
}
