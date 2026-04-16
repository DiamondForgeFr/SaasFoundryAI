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
 * Evaluate a question's `when` condition against the accumulated answers.
 * Returns true if the question would be asked.
 *
 * Note: async `when` functions are treated as applicable — the Inquirer runtime
 * will re-evaluate them properly at prompt time. This helper only uses the result
 * to report missing answers in non-interactive mode, so erring on the side of
 * "would be asked" is safer than silently skipping.
 */
function isQuestionApplicable<T extends InquirerAnswers>(q: DistinctQuestion<T>, accumulated: T): boolean {
  if (q.when === undefined) return true
  if (typeof q.when === 'boolean') return q.when
  if (typeof q.when === 'function') {
    try {
      const result = q.when(accumulated)
      if (typeof result === 'boolean') return result
      return true
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
 * - In `nonInteractive` mode, throws if any applicable question is missing a
 *   prefilled value, with a list of missing names.
 */
export async function promptWithPrefill<T extends InquirerAnswers>(questions: ReadonlyArray<DistinctQuestion<T>>, options: PromptOptions = {}): Promise<T> {
  const { prefill = {}, nonInteractive = false } = options

  if (nonInteractive) {
    const missing: string[] = []
    const accumulated = { ...prefill } as unknown as T

    for (const q of questions) {
      if (!isQuestionApplicable(q, accumulated)) continue
      const name = q.name as string
      if (getByPath(accumulated as Record<string, unknown>, name) === undefined) {
        missing.push(name)
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing required values in --non-interactive mode: ${missing.join(', ')}\n` + `Run \`sf new --help\` for the full flag list.`)
    }
  }

  const answers = await inquirer.prompt<T>(questions as unknown as DistinctQuestion<T>[], prefill as Partial<T>)
  return answers
}
