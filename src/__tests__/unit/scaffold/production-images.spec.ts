import { readFileSync } from 'fs'
import { resolve } from 'path'

const SCAFFOLDS = resolve(__dirname, '../../../../scaffolds')
const read = (path: string): string => readFileSync(resolve(SCAFFOLDS, path), 'utf8')

/** Each production Dockerfile, with the `.nvmrc` of the project it is deposited into. */
const DOCKERFILES = [
  { dockerfile: 'overlays/monorepo/api/Dockerfile', nvmrc: 'overlays/monorepo/root/.nvmrc' },
  { dockerfile: 'overlays/monorepo/web/Dockerfile', nvmrc: 'overlays/monorepo/root/.nvmrc' },
  { dockerfile: 'blueprints/api/Dockerfile', nvmrc: 'overlays/multirepo/api/.nvmrc' },
  { dockerfile: 'blueprints/web/Dockerfile', nvmrc: 'overlays/multirepo/web/.nvmrc' }
]

describe.each(DOCKERFILES)('$dockerfile', ({ dockerfile, nvmrc }) => {
  const source = read(dockerfile)

  // The generated package.json files refuse npm 10 (`devEngines.packageManager >=11`,
  // `onFail: "error"`), and node:22 ships npm 10: `npm ci` failed inside every
  // `docker build` (#860). The image runs the Node the project itself declares.
  it('builds on the Node version the project declares in .nvmrc', () => {
    const nodeImages = [...source.matchAll(/^FROM node:(\S+)/gm)].map((match) => match[1])
    expect(nodeImages.length).toBeGreaterThan(0)
    for (const tag of nodeImages) expect(tag).toBe(`${read(nvmrc).trim()}-alpine`)
  })
})
