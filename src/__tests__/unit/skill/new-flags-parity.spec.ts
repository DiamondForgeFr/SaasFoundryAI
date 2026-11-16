import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command, Option } from 'commander'
import { registerNewCommandOptions } from '../../../commands/new.options'
import { getAgentIds } from '../../../harness/agent-registry'
import { ToolCategory, toolsByCategory } from '../../../tools/catalogue'

/**
 * #968 — the skill's flag table drifted from the CLI it describes.
 *
 * `reference/new-flags.json` is what an agent reads to build a non-interactive `sf new`, and what
 * `plan-new.sh` refuses anything outside of. Six real flags (`--language`, `--docs`, `--design`,
 * `--api-port`, `--web-port`, `--no-network`) were added to the CLI and never to the table, so an
 * agent driving `sf new` from the skill could not pass them. Fixing the list by hand would drift
 * again; this spec builds the real Commander command and compares the two in both directions.
 */

interface FieldSpec {
  flag: string
  negationFlag?: string
  type: 'string' | 'enum' | 'csv' | 'boolean'
  values?: string[]
}

interface FlagTable {
  alwaysAppend: string[]
  fields: Record<string, FieldSpec>
}

const table = JSON.parse(readFileSync(resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/reference/new-flags.json'), 'utf8')) as FlagTable

const options: readonly Option[] = registerNewCommandOptions(new Command('new')).options

/** Every long flag Commander registers on `sf new`, `--no-*` negations included. */
const cliFlags = (): string[] => options.map((option) => option.long ?? '').sort()

/** Every flag the table lets an agent pass: always-appended flags, field flags and their negations. */
const tableFlags = (): string[] => [...table.alwaysAppend, ...Object.values(table.fields).flatMap((field) => [field.flag, ...(field.negationFlag ? [field.negationFlag] : [])])].sort()

const optionFor = (flag: string): Option | undefined => options.find((option) => option.long === flag)

/** Whether the Commander option takes a value (`<arg>` or `[arg]`) rather than being a switch. */
const takesValue = (option: Option): boolean => option.required || option.optional

describe('reference/new-flags.json mirrors the sf new command (#968)', () => {
  it('finds flags on both sides', () => {
    expect(cliFlags().length).toBeGreaterThan(40)
    expect(tableFlags().length).toBeGreaterThan(40)
  })

  it('lists every flag the CLI accepts', () => {
    // Naming the flags rather than counting them: the failure says which entry to add.
    const missing = cliFlags().filter((flag) => !tableFlags().includes(flag))
    expect(missing).toEqual([])
  })

  it('lists no flag the CLI does not accept', () => {
    const unknown = tableFlags().filter((flag) => !cliFlags().includes(flag))
    expect(unknown).toEqual([])
  })

  it('lists each flag once', () => {
    const flags = tableFlags()
    expect(flags.filter((flag, index) => flags.indexOf(flag) !== index)).toEqual([])
  })

  it('gives a value to the flags that take one, and none to the switches', () => {
    const mismatched: string[] = []
    for (const [key, field] of Object.entries(table.fields)) {
      const option = optionFor(field.flag)
      if (!option) continue // reported by the parity checks above
      // A boolean field renders the bare flag; a `--no-*` flag is a switch whatever the field.
      const expectsValue = field.type !== 'boolean'
      if (takesValue(option) !== expectsValue) mismatched.push(`${key} (${field.flag})`)
    }
    expect(mismatched).toEqual([])
  })

  it('maps each negation flag to a Commander negation', () => {
    for (const field of Object.values(table.fields)) {
      if (!field.negationFlag) continue
      expect(optionFor(field.negationFlag)?.negate).toBe(true)
    }
  })

  describe('accepted values follow their source of truth', () => {
    const values = (key: string): string[] => [...(table.fields[key]?.values ?? [])].sort()
    const tools = (category: ToolCategory, withNone: boolean): string[] => [...toolsByCategory(category).map((tool) => tool.name), ...(withNone ? ['none'] : [])].sort()

    it('offers every tracker, docs and design tool of the catalogue', () => {
      // `--tracker` and `--docs` accept `none`; `--design` is a list, so an empty one says it.
      expect(values('tracker')).toEqual(tools('tracker', true))
      expect(values('docs')).toEqual(tools('docs', true))
      expect(values('design')).toEqual(tools('design', false))
    })

    it('offers every registered coding-agent profile', () => {
      expect(values('agents')).toEqual([...getAgentIds()].sort())
    })
  })
})
