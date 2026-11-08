import fs from 'fs'
import path from 'path'

import { resolveSkillInstallDir, resolveUserHome } from '../skill/paths'
import type { SaaSFoundryManifest } from '../types'
import type { StatusReport } from './collect'
import { compareCliVersions } from './instruction-diagnostics'
import type { Precondition } from './preconditions'

/**
 * Personal skills that hide or compete with the project's own (#1107).
 *
 * Claude Code gives a personal skill (`~/.claude/skills/<name>`) precedence over a project skill
 * (`.claude/skills/<name>`) of the same name (https://code.claude.com/docs/en/skills), and `sf skill
 * install` used to write into the personal directory by default. The project then runs a copy nobody
 * versions with it, and nothing in the session says so: an older `tool-saasfoundry` kept shipping an
 * outdated `plan-milestone.sh`, and a personal `tool-github-projects` answered the triggers of the
 * project's `sf-tool-github-projects`.
 *
 * Three facts are read, none of which runs a process or touches the network:
 *
 * - **Same name**: a personal folder named like a project skill hides it. Reported whatever the content.
 * - **Older version**: when both folders carry a `.version` that can be compared, the report says
 *   whether the personal copy is the older one (`sf skill install` writes `{ "cliVersion": … }`; a bare
 *   semver text is read too). A skill without a readable `.version` is reported without a version claim.
 * - **Overlapping triggers**: a personal skill with another name that repeats a quoted trigger phrase of
 *   a project skill's `description` (`Triggers on "create ticket", …`).
 *
 * The trigger check is deliberately blunt. It compares the double-quoted phrases of the frontmatter
 * `description`, lower-cased with their white space collapsed, and one shared phrase is enough. It does
 * not see paraphrases, unquoted keywords or the body of the skill; it can flag a generic phrase two
 * unrelated skills happen to quote; and it only looks at `.claude/skills` (the project's, and the app
 * directories of a multirepo) against `~/.claude/skills`. The phrases are listed in the report so the
 * developer judges each one.
 */

/** The shortest quoted phrase read as a trigger: `pr` would match half the personal skills. */
const MIN_PHRASE_LENGTH = 3

/** Bytes read from the start of a `SKILL.md`: its frontmatter sits at the top. */
const HEAD_BYTES = 16 * 1024

/** A project skill a personal one is compared with. */
interface SkillFolder {
  name: string
  path: string
  /** The folder with every link resolved: two folders with the same real path are one skill. */
  realPath: string
  version?: string
  triggers: string[]
}

export interface PersonalSkillFinding {
  /** Name of the personal skill (its folder name). */
  name: string
  /** The folder to remove. */
  path: string
  /** The project skill of the same name that this folder hides. */
  shadows?: {
    projectPath: string
    personalVersion?: string
    projectVersion?: string
    /** Present only when both versions could be compared. */
    older?: boolean
  }
  /** Project skills of another name whose quoted trigger phrases this skill repeats. */
  overlaps: { projectSkill: string; phrases: string[] }[]
}

export interface PersonalSkillsState {
  /** The personal skills directory that was read. */
  directory: string
  /** Personal skills compared with the project's. */
  checked: number
  /** Project skills they were compared with. */
  projectSkills: string[]
  findings: PersonalSkillFinding[]
}

/** The personal skills against the project's, or why they could not be read: status never fails on it. */
export type StatusPersonalSkills = PersonalSkillsState | { error: string }

function realPathOf(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}

function readHead(file: string): string | undefined {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(HEAD_BYTES)
    const bytes = fs.readSync(fd, buffer, 0, HEAD_BYTES, 0)
    return buffer.subarray(0, bytes).toString('utf8')
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** The `description` of a SKILL.md frontmatter: a one-line value, or a folded/literal block. Empty when there is none. */
export function skillDescription(content: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) return ''
  const lines = match[1].split(/\r?\n/)
  const start = lines.findIndex((line) => /^description:/.test(line))
  if (start < 0) return ''
  const first = lines[start].slice('description:'.length).trim()
  const continuation: string[] = []
  for (let index = start + 1; index < lines.length && /^[ \t]+\S/.test(lines[index]); index++) continuation.push(lines[index].trim())
  const value = /^[|>][-+]?$/.test(first) ? continuation.join(' ') : [first, ...continuation].filter(Boolean).join(' ')
  return unwrapScalar(value)
}

/** A description written as one quoted YAML scalar loses its outer quotes, so they are not read as a trigger phrase. */
function unwrapScalar(value: string): string {
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === 'string') return parsed
    } catch {
      // Not a valid double-quoted scalar: the text is read as written.
    }
  }
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  return value
}

function normalizePhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '')
}

/** The double-quoted phrases of a description, normalized and de-duplicated, in order of appearance. */
export function triggerPhrases(description: string): string[] {
  const phrases: string[] = []
  for (const match of description.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g)) {
    const phrase = normalizePhrase(match[1] ?? match[2])
    if (phrase.length >= MIN_PHRASE_LENGTH && /[\p{L}\p{N}]/u.test(phrase) && !phrases.includes(phrase)) phrases.push(phrase)
  }
  return phrases
}

/** The version a skill folder records in `.version`: `sf skill install` writes JSON with `cliVersion`; a bare semver text is read too. */
export function skillVersion(folder: string): string | undefined {
  let raw: string
  try {
    raw = fs.readFileSync(path.join(folder, '.version'), 'utf8').trim()
  } catch {
    return undefined
  }
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed.trim() || undefined
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as { cliVersion?: unknown; version?: unknown }
      for (const candidate of [record.cliVersion, record.version]) if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
    return undefined
  } catch {
    // Not JSON: a bare version text such as `1.0.0`.
    return /^\S+$/.test(raw) ? raw : undefined
  }
}

/** The skills of a directory: the folders holding a `SKILL.md`, links followed (a contributor may symlink a skill from the templates). */
function readSkillFolders(skillsDir: string): SkillFolder[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const skills: SkillFolder[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = path.join(skillsDir, entry.name)
    try {
      if (!fs.statSync(folder).isDirectory()) continue
    } catch {
      continue
    }
    const head = readHead(path.join(folder, 'SKILL.md'))
    if (head === undefined) continue
    const version = skillVersion(folder)
    skills.push({ name: entry.name, path: folder, realPath: realPathOf(folder), ...(version ? { version } : {}), triggers: triggerPhrases(skillDescription(head)) })
  }
  return skills
}

/** The directories whose skills Claude Code loads for the project; the same ones the `skills:` line lists. */
function projectSkillDirs(projectRoot: string, manifest: SaaSFoundryManifest): string[] {
  const dirs = [path.join(projectRoot, '.claude', 'skills')]
  if (manifest.structure === 'multirepo') dirs.push(path.join(projectRoot, 'apps', 'api', '.claude', 'skills'), path.join(projectRoot, 'apps', 'web', '.claude', 'skills'))
  return dirs
}

/**
 * Compare the personal skills of `userHome` with the project's. Absent without a manifest (there is no
 * managed project to shadow). Nothing here writes, spawns a process or reaches the network.
 */
export function collectPersonalSkills(projectRoot: string, manifest: SaaSFoundryManifest | null, userHome: string = resolveUserHome()): StatusPersonalSkills | undefined {
  if (!manifest) return undefined
  const directory = path.join(userHome, '.claude', 'skills')
  try {
    const projectDirs = projectSkillDirs(projectRoot, manifest)
    const projectSkills = projectDirs.flatMap(readSkillFolders)
    // Running from the home directory makes the two sets one: nothing can hide itself.
    const personalRoot = realPathOf(directory)
    if (projectDirs.some((dir) => realPathOf(dir) === personalRoot)) return { directory, checked: 0, projectSkills: projectSkills.map((skill) => skill.name), findings: [] }

    const personal = readSkillFolders(directory)
    const findings: PersonalSkillFinding[] = []
    for (const skill of personal) {
      // A link to the very folder the project holds is one skill, not a shadow.
      if (projectSkills.some((project) => project.realPath === skill.realPath)) continue
      const twin = projectSkills.find((project) => project.name === skill.name)
      const overlaps = projectSkills
        .filter((project) => project.name !== skill.name)
        .map((project) => ({ projectSkill: project.name, phrases: skill.triggers.filter((phrase) => project.triggers.includes(phrase)) }))
        .filter((overlap) => overlap.phrases.length > 0)
      if (!twin && overlaps.length === 0) continue
      const comparison = twin?.version && skill.version ? compareCliVersions(skill.version, twin.version) : undefined
      findings.push({
        name: skill.name,
        path: skill.path,
        ...(twin
          ? {
              shadows: {
                projectPath: twin.path,
                ...(skill.version ? { personalVersion: skill.version } : {}),
                ...(twin.version ? { projectVersion: twin.version } : {}),
                ...(comparison !== undefined ? { older: comparison < 0 } : {})
              }
            }
          : {}),
        overlaps
      })
    }
    return { directory, checked: personal.length, projectSkills: Array.from(new Set(projectSkills.map((skill) => skill.name))).sort(), findings }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const PLAIN_PATH = /^[\w@%+=:,./-]+$/

/** A path as a shell reads it back: quoted only when it has to be. */
function shellPath(value: string): string {
  return PLAIN_PATH.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

const MAX_PHRASES_SHOWN = 4

function describeFinding(finding: PersonalSkillFinding): string {
  const parts: string[] = []
  if (finding.shadows) {
    const { personalVersion, projectVersion, older } = finding.shadows
    const version =
      older === true
        ? ` (its .version ${personalVersion} is older than the project's ${projectVersion})`
        : personalVersion && projectVersion
          ? ` (.version ${personalVersion}, the project's is ${projectVersion})`
          : ''
    parts.push(`hides the project skill of the same name${version}`)
  }
  for (const overlap of finding.overlaps) {
    const shown = overlap.phrases.slice(0, MAX_PHRASES_SHOWN).map((phrase) => `"${phrase}"`)
    const more = overlap.phrases.length - shown.length
    parts.push(`answers the same triggers as ${overlap.projectSkill} (${shown.join(', ')}${more > 0 ? `, +${more} more` : ''})`)
  }
  return `${finding.path} ${parts.join(' and ')}`
}

/**
 * `personalSkills`: no personal skill hides a project skill, or answers its triggers. Left out when the
 * report did not collect them, like the other checks of the CLI that answers. A finding is a `warn`: the
 * session still runs, on skills the project does not control. Removing a personal skill is the
 * developer's decision, so the remediation names the folder and the command, and runs nothing.
 */
export function checkPersonalSkills(report: StatusReport): Precondition | undefined {
  const state = report.personalSkills
  if (!state) return undefined
  const name = 'personalSkills'
  const description = 'No personal skill hides or competes with a project skill'
  if ('error' in state) return { name, description, status: 'skip', details: `Personal skills could not be read: ${state.error}` }
  if (state.findings.length === 0) {
    return {
      name,
      description,
      status: 'ok',
      details:
        state.checked === 0
          ? `No personal skill in ${state.directory}`
          : `${state.checked} personal skill${state.checked === 1 ? '' : 's'} checked against ${state.projectSkills.length} project skill${state.projectSkills.length === 1 ? '' : 's'}`
    }
  }
  // `sf skill uninstall --user` removes exactly the folder `sf skill install` wrote, when this report reads the same home.
  const installerFolder = resolveSkillInstallDir('user')
  const commands = state.findings.map((finding) => (finding.path === installerFolder ? 'sf skill uninstall --user' : `rm -r ${shellPath(finding.path)}`))
  return {
    name,
    description,
    status: 'warn',
    details: `Claude Code gives personal skills precedence over project skills: ${state.findings.map(describeFinding).join('; ')}`,
    remediation: `Remove the personal copy so the project's skill applies (or move it out of ~/.claude/skills): ${Array.from(new Set(commands)).join(' && ')}`
  }
}
