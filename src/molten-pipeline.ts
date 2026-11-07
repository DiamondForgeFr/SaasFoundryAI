import fs from 'fs'
import path from 'path'

/** Where MoltenTerm declares a project's local pipeline, relative to the project root. */
export const MOLTEN_PROJECT_FILE = path.join('.molten', 'project.json')

/** One CI job a `.molten/project.json` declares in `ci.jobs`: its name is the status it publishes. */
export interface MoltenCiJob {
  name: string
  title?: string
  lane?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The CI jobs a parsed `.molten/project.json` declares (#1155): the entries of `ci.jobs` that carry a name.
 * A file without `ci`, without `ci.jobs`, or with an empty list declares none, and a pipeline with no job
 * is not a local CI: `molten ci status` answers "the pipeline declares no CI job" and there is nothing to run.
 */
export function declaredMoltenJobs(project: unknown): MoltenCiJob[] {
  const ci = isRecord(project) ? project.ci : undefined
  const jobs = isRecord(ci) && Array.isArray(ci.jobs) ? ci.jobs : []
  return jobs.flatMap((job) =>
    isRecord(job) && typeof job.name === 'string' && job.name.trim() !== ''
      ? [{ name: job.name, ...(typeof job.title === 'string' ? { title: job.title } : {}), ...(typeof job.lane === 'string' ? { lane: job.lane } : {}) }]
      : []
  )
}

/**
 * The CI jobs the project's `.molten/project.json` declares, read from disk: undefined when the file does not
 * exist, an empty list when it declares none. Throws when the file cannot be read or parsed; it never runs `molten`.
 */
export function readMoltenCiJobs(projectRoot: string): MoltenCiJob[] | undefined {
  const file = path.join(projectRoot, MOLTEN_PROJECT_FILE)
  if (!fs.existsSync(file)) return undefined
  return declaredMoltenJobs(JSON.parse(fs.readFileSync(file, 'utf8')))
}
