import { readFile, readdir } from 'fs/promises'
import { join } from 'path'

const engineRoot = join(__dirname, '../../../config-engine')

/**
 * AC FR-CONFIG-ENGINE-01: step definitions are renderer-agnostic. Only the
 * renderers/ folder may know about Inquirer — everything else in the engine
 * must stay medium-neutral so the TUI stepper and the web GUI can reuse it.
 */
describe('config-engine conventions', () => {
  it('never imports inquirer outside of renderers/', async () => {
    const offenders: string[] = []

    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'renderers') continue
          await walk(path)
        } else if (entry.name.endsWith('.ts')) {
          const source = await readFile(path, 'utf8')
          if (/from 'inquirer'|require\('inquirer'\)/.test(source)) {
            offenders.push(path)
          }
        }
      }
    }

    await walk(engineRoot)

    expect(offenders).toEqual([])
  })
})
