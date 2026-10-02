import { readFileSync } from 'fs'
import { join, resolve } from 'path'

import { engines } from '../../../../package.json'

const ROOT = resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const minimumMajor = (range: string) => /^>=\s*(\d+)/.exec(range)?.[1]

// #826 — the harness guides asked for the generated stack's Node 24.19.0 / npm 11 while the
// CLI accepts Node 22: a first-time user upgraded Node for nothing, or doubted their setup
describe('documented prerequisites', () => {
  const cliNode = minimumMajor(engines.node)
  const cliNpm = minimumMajor(engines.npm)
  const stackNode = read('scaffolds/overlays/monorepo/root/.nvmrc').trim()

  it('reads the minimums it checks from the sources of truth', () => {
    expect(cliNode).toMatch(/^\d+$/)
    expect(cliNpm).toMatch(/^\d+$/)
    expect(stackNode).toMatch(/^\d+\.\d+\.\d+$/)
    expect(read('scaffolds/overlays/multirepo/api/.nvmrc').trim()).toBe(stackNode)
  })

  it.each([
    ['docs/getting-started/install-harness.md', `Node.js ${cliNode} or newer and npm ${cliNpm} or newer`, `Node.js ${stackNode}`],
    ['docs/fr/getting-started/install-harness.md', `Node.js ${cliNode} ou plus récent et npm ${cliNpm} ou plus récent`, `Node.js ${stackNode}`],
    ['docs/getting-started/installation.md', `**Node.js ${cliNode} or newer** and **npm ${cliNpm} or newer**`, `**Node.js ${stackNode}**`],
    ['docs/fr/getting-started/installation.md', `**Node.js ${cliNode} ou plus récent** et **npm ${cliNpm} ou plus récent**`, `**Node.js ${stackNode}**`],
    ['README.md', `Node.js ${cliNode} or newer with npm ${cliNpm} or newer`, `Node.js ${stackNode}`]
  ])('%s names the CLI minimum from package.json engines and the stack version from .nvmrc', (file, cli, stack) => {
    const content = read(file)
    expect(content).toContain(cli)
    expect(content).toContain(stack)
  })
})
