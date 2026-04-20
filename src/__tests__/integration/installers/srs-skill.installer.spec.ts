import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { installSrsSkill } from '../../../installers/srs-skill.installer'

describe('installSrsSkill', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-install-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('copies the bundle under .claude/skills/sf-srs/', async () => {
    await installSrsSkill({ targetPath: tmp })

    const root = join(tmp, '.claude', 'skills', 'sf-srs')
    expect(statSync(join(root, 'SKILL.md')).isFile()).toBe(true)
    expect(statSync(join(root, 'scripts', 'srs-cli.sh')).isFile()).toBe(true)
    expect(statSync(join(root, 'templates', 'pages')).isDirectory()).toBe(true)
    expect(statSync(join(root, 'templates', 'tickets')).isDirectory()).toBe(true)
  })

  it('preserves the executable bit on srs-cli.sh', async () => {
    await installSrsSkill({ targetPath: tmp })

    const script = join(tmp, '.claude', 'skills', 'sf-srs', 'scripts', 'srs-cli.sh')
    const mode = statSync(script).mode & 0o777
    expect(mode & 0o100).toBe(0o100)
  })

  it('returns the resolved target directory', async () => {
    const result = await installSrsSkill({ targetPath: tmp })
    expect(result).toBe(join(tmp, '.claude', 'skills', 'sf-srs'))
  })
})
