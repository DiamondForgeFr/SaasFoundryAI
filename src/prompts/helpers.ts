import inquirer, { Answers as InquirerAnswers, DistinctQuestion } from 'inquirer'

export interface PromptOptions {
  prefill?: Record<string, unknown>
  nonInteractive?: boolean
}

/**
 * Resolve a dot-notation path against an object, matching Inquirer's _.get semantics.
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return current
}

/**
 * Write a dot-notation path, copying each object it descends through.
 *
 * The copy matters: `accumulated` starts as a shallow spread of the caller's prefill, so
 * writing straight through would mutate the caller's nested objects — a resolved default
 * would leak back into whatever built the prefill.
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  for (const part of parts.slice(0, -1)) {
    const next = current[part]
    current[part] = next !== null && typeof next === 'object' ? { ...(next as Record<string, unknown>) } : {}
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

/**
 * The value a question's `default` would supply, or undefined when it has none.
 *
 * A default may be a function of the answers so far — `(current) => `${current.projectName}-uploads``
 * — which is why this is evaluated in field order against the accumulated set rather than
 * once up front.
 *
 * A throwing or async default reads as absent. Neither can be honoured here (there is
 * nothing to await against), and reporting the field as missing is the truthful outcome —
 * the same choice `isQuestionApplicable` makes for a `when` it cannot evaluate.
 */
function resolveDefault<T extends InquirerAnswers>(question: DistinctQuestion<T>, accumulated: T): unknown {
  const declared = (question as { default?: unknown }).default
  if (declared === undefined) return undefined
  if (typeof declared !== 'function') return declared

  try {
    const value = (declared as (answers: T) => unknown)(accumulated)
    const isThenable = value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function'
    return isThenable ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * Evaluate a question's `when` condition against the accumulated answers.
 * Returns true if the question would be asked.
 *
 * Matches Inquirer's truthy/falsy semantics for sync callbacks. Async callbacks
 * (which return a Promise) are treated as applicable — we can't await here, and
 * erring on "would be asked" keeps the non-interactive error list complete.
 */
function isQuestionApplicable<T extends InquirerAnswers>(q: DistinctQuestion<T>, accumulated: T): boolean {
  if (q.when === undefined) return true
  if (typeof q.when === 'boolean') return q.when
  if (typeof q.when === 'function') {
    try {
      const result = q.when(accumulated)
      if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
        return true
      }
      return Boolean(result)
    } catch {
      return true
    }
  }
  return true
}

/**
 * Wrap `inquirer.prompt` with prefill + non-interactive support.
 *
 * - Questions whose name already has a value in `prefill` are skipped (Inquirer's
 *   native behavior via the second argument).
 * - In `nonInteractive` mode, a question's declared `default` counts as an answer, and
 *   only a question with neither a prefill nor a default is missing.
 *
 * That last rule is the whole of #607. This used to report a field as missing even when
 * its step declared a default, so a scripted run had to supply values the CLI already knew
 * how to choose — `--s3-bucket` under `--s3-setup docker`, `--db-user/--db-password/--db-name`
 * under `--db-setup docker`, `--db-type` under `--db-setup credentials`. Interactive runs
 * never saw it, because inquirer applies those defaults itself.
 *
 * No field needs special-casing: the step definitions already separate what can be guessed
 * from what cannot. A bucket name and a region have defaults; someone else's S3 endpoint
 * and keys, and someone else's database host and port, have none — and still refuse.
 */
export async function promptWithPrefill<T extends InquirerAnswers>(questions: ReadonlyArray<DistinctQuestion<T>>, options: PromptOptions = {}): Promise<T> {
  const { prefill = {}, nonInteractive = false } = options
  let answerable = prefill

  if (nonInteractive) {
    const missing = new Set<string>()
    const accumulated = { ...prefill }

    for (const q of questions) {
      if (!isQuestionApplicable(q, accumulated as unknown as T)) continue
      const name = q.name as string
      if (getByPath(accumulated, name) !== undefined) continue

      const fallback = resolveDefault(q, accumulated as unknown as T)
      if (fallback === undefined) {
        missing.add(name)
        continue
      }

      // Written back so a later `when` — or a later default reading an earlier field —
      // sees the value this one just supplied.
      setByPath(accumulated, name, fallback)
    }

    if (missing.size > 0) {
      throw new Error(`Missing required values in --non-interactive mode: ${Array.from(missing).join(', ')}\n` + `Run the command with \`--help\` for the full flag list.`)
    }

    // The resolved set, so inquirer has nothing left to ask.
    answerable = accumulated
  }

  const answers = await inquirer.prompt<T>(questions as unknown as DistinctQuestion<T>[], answerable as Partial<T>)
  return answers
}
