import { readFileSync } from 'fs'
import { load } from 'js-yaml'
import { resolve } from 'path'

import { monorepoBuildContext } from '../../../utils'

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

  // The source label pointed every image at the template's placeholder repository (#884);
  // docker/metadata-action sets the project's own in CI.
  it('does not label the image as the template repository', () => {
    expect(source).not.toMatch(/agachet|LABEL org\.opencontainers\.image\.source/)
  })
})

/** The instructions of each stage, continuation lines joined, comments dropped. */
function stagesOf(source: string): Record<string, string[]> {
  const instructions = source
    .replace(/\\\n\s*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  const stages: Record<string, string[]> = {}
  let current: string[] = []
  for (const instruction of instructions) {
    const from = /^FROM \S+ AS (\S+)$/.exec(instruction)
    if (from) stages[from[1]] = current = []
    else current.push(instruction)
  }
  return stages
}

const indexOf = (instructions: string[], pattern: RegExp): number => instructions.findIndex((instruction) => pattern.test(instruction))

const NGINX_LISTEN = Number(/^\s*listen (\d+);/m.exec(read('blueprints/web/nginx.conf'))![1])

describe.each([
  { dockerfile: 'overlays/monorepo/api/Dockerfile', manifest: 'overlays/monorepo/api/package.json', monorepo: true },
  { dockerfile: 'blueprints/api/Dockerfile', manifest: 'overlays/multirepo/api/package.json', monorepo: false }
])('API image $dockerfile (#861)', ({ dockerfile, manifest, monorepo }) => {
  const { builder, runner } = stagesOf(read(dockerfile))
  const packageJson = JSON.parse(read(manifest)) as { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> }

  // Without prisma.config.ts Prisma never finds the multi-file schema, and without
  // tsconfig.json the client imports `./internal/class.ts`, which node cannot load.
  it('generates the Prisma client once the API sources, its config and tsconfig.json are in place', () => {
    const sources = indexOf(builder, monorepo ? /^COPY apps\/api\/ \.\/apps\/api\/$/ : /^COPY \. \.$/)
    const generate = indexOf(builder, /prisma generate/)
    expect(sources).toBeGreaterThanOrEqual(0)
    expect(generate).toBeGreaterThan(sources)
  })

  if (monorepo) {
    // The API imports @<project>/shared-* at runtime, from their built dist/.
    it('installs, builds and ships the shared packages the API imports', () => {
      expect(indexOf(builder, /^COPY packages \.\/packages$/)).toBeLessThan(indexOf(builder, /^RUN npm ci$/))
      expect(builder).toContain('COPY turbo.json ./')
      expect(builder).toContain('RUN npx turbo run build --filter=./apps/api...')
      expect(runner).toContain('COPY --from=builder /app/packages ./packages')
    })
  }

  it('starts the entry point the prod script runs', () => {
    const workdirs = runner.filter((instruction) => instruction.startsWith('WORKDIR '))
    expect(workdirs.at(-1)).toBe(monorepo ? 'WORKDIR /app/apps/api' : 'WORKDIR /app')
    const cmd = JSON.parse(runner.find((instruction) => instruction.startsWith('CMD '))!.slice(4)) as string[]
    expect(cmd).toEqual(['node', `${packageJson.scripts.prod.replace(/^node /, '')}.js`])
  })

  // alpine resolves localhost to ::1 first, where nothing listens.
  it('checks its health on the IPv4 loopback', () => {
    expect(runner.find((instruction) => instruction.startsWith('HEALTHCHECK '))).toContain('http://127.0.0.1:$PORT/api/health')
  })

  it('writes its logs to a directory the runtime user owns', () => {
    expect(runner).toContain('ENV LOG_DIR=/app/logs')
    const prepare = indexOf(runner, /^RUN mkdir -p logs .*chown -R ci-deploy:users logs/)
    expect(prepare).toBeGreaterThanOrEqual(0)
    expect(prepare).toBeLessThan(indexOf(runner, /^USER ci-deploy$/))
  })

  it('ships the schema, its SQL and the update script with the Prisma CLI', () => {
    const at = monorepo ? 'apps/api/' : ''
    expect(runner).toEqual(expect.arrayContaining([`COPY ${at}prisma.config.ts ./${at}`, `COPY ${at}prisma ./${at}prisma`, `COPY ${at}scripts ./${at}scripts`]))
    expect(runner.find((instruction) => instruction.startsWith('RUN npm ci --omit=dev'))).toContain('npm rebuild prisma @prisma/engines')
    expect(packageJson.dependencies.prisma).toBeDefined()
    expect(packageJson.devDependencies.prisma).toBeUndefined()
    expect(packageJson.scripts['db:update']).toBe('./scripts/update-db.sh')
  })
})

describe('scripts/update-db.sh (#861)', () => {
  const script = read('blueprints/api/scripts/update-db.sh')
  const code = script
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')

  // The alpine runner has no bash.
  it('is POSIX sh', () => {
    expect(script.split('\n')[0]).toBe('#!/bin/sh')
    for (const bashism of [/\[\[/, /pipefail/, /^\s*trap /m, /^\s*local /m, /^\s*function /m]) expect(code).not.toMatch(bashism)
  })

  it('updates forward only, from DATABASE_URL in the environment', () => {
    expect(code).toContain(': "${DATABASE_URL:?DATABASE_URL must be set}"')
    expect(code).toContain('npx prisma db push\n')
    expect(code).not.toMatch(/force-reset|accept-data-loss|\.env/)
    for (const directory of ['migrations/pre-schema', 'functions', 'triggers', 'datasets', 'migrations/post-schema']) expect(script).toContain(`"prisma/sql/${directory}"`)
  })

  it('is the update the development script runs too', () => {
    expect(read('blueprints/api/scripts/update-db-dev.sh')).toContain('"$(dirname "$0")/update-db.sh"')
  })
})

describe.each([
  { dockerfile: 'overlays/monorepo/web/Dockerfile', monorepo: true },
  { dockerfile: 'blueprints/web/Dockerfile', monorepo: false }
])('web image $dockerfile (#861)', ({ dockerfile, monorepo }) => {
  const stages = stagesOf(read(dockerfile))
  const runner = stages.runner

  it('exposes and checks the port nginx listens on', () => {
    expect(runner).toContain(`EXPOSE ${NGINX_LISTEN}`)
    expect(runner.find((instruction) => instruction.startsWith('HEALTHCHECK '))).toContain(`http://127.0.0.1:${NGINX_LISTEN}/`)
  })

  if (monorepo) {
    // The web app imports @<project>/ui-primitives, api-client and shared-validation.
    it('installs and builds the shared packages the web app imports', () => {
      const { builder } = stages
      expect(indexOf(builder, /^COPY packages \.\/packages$/)).toBeLessThan(indexOf(builder, /^RUN npm ci$/))
      expect(builder).toContain('COPY turbo.json ./')
      expect(builder).toContain('RUN npx turbo run build --filter=./apps/web...')
    })
  } else {
    // `COPY . .` laid the developer's darwin node_modules and .env over the image's own.
    it('keeps node_modules and .env out of the build context', () => {
      const ignored = read('blueprints/web/.dockerignore').split('\n')
      expect(ignored).toEqual(expect.arrayContaining(['node_modules', '.env', '.env.*']))
    })
  }
})

describe('nginx.conf (#861)', () => {
  const conf = read('blueprints/web/nginx.conf')

  // A name resolved once at startup goes stale when the API container is redeployed with
  // a new address: every proxied request then answered 502 until nginx restarted.
  it('resolves the API container per request through the Docker DNS', () => {
    expect(conf).toMatch(/^\s*resolver 127\.0\.0\.11 valid=\d+s ipv6=off;$/m)
    expect(conf).toContain('set $api_upstream http://saasfoundry-api:3500;')
    expect(conf).toContain('proxy_pass $api_upstream;')
    expect(conf).not.toMatch(/proxy_pass http/)
  })
})

interface ComposeService {
  image: string
  build: { context: string; dockerfile: string }
  ports?: string[]
  volumes?: string[]
  env_file?: string[]
  healthcheck: { test: string[] }
}
const serviceOf = (path: string, name: string): ComposeService => (load(read(path)) as { services: Record<string, ComposeService> }).services[name]

describe('compose files (#861)', () => {
  it('runs the API from the deployed image, logging to a volume the image owns', () => {
    const backend = serviceOf('blueprints/api/docker-compose.yml', 'backend')
    expect(backend.image).toBe('${API_IMAGE:-saasfoundry-api}')
    expect(backend.ports).toEqual(['127.0.0.1:${BACKEND_PORT:-3500}:3500'])
    // A host directory is root-owned: the unprivileged runtime user could not write to it
    expect(backend.volumes).toEqual(['api-logs:/app/logs'])
    expect(backend.healthcheck.test).toContain('http://127.0.0.1:3500/api/health')
  })

  it('runs the web app from the deployed image, mounting only its nginx configuration', () => {
    const frontend = serviceOf('blueprints/web/docker-compose.yml', 'frontend')
    expect(frontend.image).toBe('${WEB_IMAGE:-saasfoundry-web}')
    expect(frontend.volumes).toEqual(['./nginx.conf:/etc/nginx/conf.d/default.conf:ro'])
    expect(frontend.env_file).toBeUndefined()
    expect(frontend.healthcheck.test).toContain(`http://127.0.0.1:${NGINX_LISTEN}/`)
  })

  it.each(['api', 'web'] as const)('builds the monorepo %s image from the repository root', (app) => {
    const compose = read(`blueprints/${app}/docker-compose.yml`)
    const rewritten = load(monorepoBuildContext(compose, app)) as { services: Record<string, ComposeService> }
    expect(Object.values(rewritten.services)[0].build).toEqual({ context: '../..', dockerfile: `apps/${app}/Dockerfile` })
  })
})

/** Variables the API refuses to start without: neither defaulted nor optional, and not left commented out. */
const REQUIRED_API_ENV = [...read('blueprints/api/src/configs/env/services/env.service.ts').matchAll(/^\s+([A-Z][A-Z0-9_]+): (z\..*)$/gm)]
  .filter(([, , schema]) => !/\.default\(|\.optional\(\)/.test(schema))
  .map(([, name]) => name)

describe.each([
  { workflow: 'blueprints/api/.github/workflows/deployment.yml', app: 'api', files: ['docker-compose.yml'] },
  { workflow: 'blueprints/web/.github/workflows/deployment.yml', app: 'web', files: ['docker-compose.yml', 'nginx.conf'] },
  { workflow: 'overlays/monorepo/root/.github/workflows/deployment-api.yml', app: 'api', files: ['apps/api/docker-compose.yml'] },
  { workflow: 'overlays/monorepo/root/.github/workflows/deployment-web.yml', app: 'web', files: ['apps/web/docker-compose.yml', 'apps/web/nginx.conf'] }
])('deployment workflow $workflow (#861)', ({ workflow, app, files }) => {
  const source = read(workflow)
  const deploy = (load(source) as { jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps: { name?: string; run?: string }[] }> }).jobs.deploy
  const script = deploy.steps.map((step) => step.run ?? '').join('\n')

  it('deploys to any Docker host, not to a Synology NAS', () => {
    expect(source).not.toMatch(/NAS_|cinas|\/usr\/local\/bin|docker-compose /)
    expect(deploy.if).toBe("vars.DEPLOY_HOST != ''")
    expect(deploy.permissions).toEqual({ contents: 'read', packages: 'read' })
  })

  it('checks the host key instead of trusting any', () => {
    expect(source).not.toContain('StrictHostKeyChecking no')
    expect(script).toContain('StrictHostKeyChecking yes')
    expect(script).toContain('"$DEPLOY_KNOWN_HOSTS" > ~/.ssh/known_hosts')
  })

  it.each(files)('uploads %s from where the project keeps it', (file) => {
    expect(script).toMatch(new RegExp(`^scp -q ${file.replace(/[.]/g, '\\.')} "deploy-target:`, 'm'))
  })

  if (app === 'api') {
    // The NAS workflow never wrote JWT_INVITATION_EXPIRES_IN: the API refused to start.
    it('writes every variable the API refuses to start without', () => {
      expect(REQUIRED_API_ENV.length).toBeGreaterThan(10)
      for (const name of REQUIRED_API_ENV) expect(script).toMatch(new RegExp(`^ *env_line ${name} `, 'm'))
      expect(script).not.toMatch(/env_line LOG_DIR /)
    })

    // The remote script arrives on stdin: `compose run` read the rest of it and the deploy stopped there.
    it('updates the database before starting the new image, without swallowing the remote script', () => {
      expect(script).toContain('docker compose run --rm --no-deps -T backend npm run db:update </dev/null')
      expect(script.indexOf('npm run db:update')).toBeLessThan(script.indexOf('docker compose up -d --no-build backend'))
    })
  }
})
