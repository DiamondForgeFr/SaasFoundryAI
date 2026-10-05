/** The workflow choice carried by `--workflow <preset>` / `--no-workflow`. */
export interface WorkflowFlag {
  preset?: 'solo' | 'saasfoundry'
  disabled?: boolean
}

/**
 * Parse `--workflow` / `--no-workflow`, shared by `sf new` and `sf update` so
 * both refuse the same values. Commander sets `false` for `--no-workflow`.
 */
export function parseWorkflowFlag(value: string | boolean | undefined): WorkflowFlag {
  if (value === undefined) return {}
  if (value === false || value === 'none') return { disabled: true }
  if (value === 'solo' || value === 'saasfoundry') return { preset: value }
  throw new Error(`Invalid --workflow "${String(value)}". Expected one of: solo, saasfoundry, none.`)
}
