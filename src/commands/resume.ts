import chalk from 'chalk'
import fs from 'fs'
import path from 'path'

import { canConnect, DEFAULT_PORTS, waitForPort } from '../ports'
import { run, runRequired } from '../run'
import { appPaths } from '../status/collect'
import type { SaaSFoundryManifest } from '../types'
import { getNvmPrefix, readManifest } from '../utils'

/**
 * Finish a setup that stopped one step short.
 *
 * `sf new` writes everything, then runs the post-setup steps. When one of those fails, the
 * project is complete minus one step and there was no way to finish it: three commands, one
 * needing a network name derived from the project, another a path that depends on the
 * topology. `sf` knew all of it — it ran them the first time (#588).
 *
 * Rerunning `sf new` is not the answer: the directory exists and the manifest is written, so
 * it refuses, correctly.
 *
 * **A separate verb, not `sf new --resume`.** This is run from a project that already
 * exists, so "new" is the wrong word for it, and a user stuck half-way looks at `sf --help`
 * rather than at the flags of the command that left them there.
 */

export interface ResumeOptions {
  /** Report what would run, change nothing. */
  dryRun?: boolean
}

type StepOutcome = 'done' | 'skipped' | 'blocked'

interface StepResult {
  outcome: StepOutcome
  message: string
}

/** Every skip says why. A step that goes quiet is indistinguishable from one that ran. */
function skipped(message: string): StepResult {
  return { outcome: 'skipped', message }
}

function done(message: string): StepResult {
  return { outcome: 'done', message }
}

function blocked(message: string): StepResult {
  return { outcome: 'blocked', message }
}

/** The connection string the project itself uses — the same one `db:setup:dev` reads. */
function databaseUrl(apiDir: string): string | null {
  const envPath = path.join(apiDir, '.env')
  if (!fs.existsSync(envPath)) return null
  const match = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)
  return match ? match[1] : null
}

/**
 * Whether the database already holds tables.
 *
 * This is the guard the whole command turns on: `db:setup:dev` is
 * `prisma db push --force-reset`, which drops the public schema. "Finish the setup" must
 * never mean "reset the database you have been working in".
 *
 * An unreadable answer counts as unknown, and unknown refuses — declining to touch a
 * database we cannot read is the only safe direction to be wrong in.
 *
 * Asked through the container when there is one, so a host without `psql` does not turn
 * every run into a refusal.
 */
function databaseHasTables(apiDir: string, projectName: string, hostedHere: boolean): boolean | 'unknown' {
  const query = "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"

  let result
  if (hostedHere) {
    const compose = path.join(apiDir, 'docker-compose.dev-services.yml')
    const url = databaseUrl(apiDir)
    const user = url?.match(/\/\/([^:]+):/)?.[1] ?? 'db_dev_user'
    const database = url?.match(/\/([^/?]+)(\?|$)/)?.[1] ?? 'db_dev'
    result = run(`docker compose -f ${compose} exec -T db-dev psql -U ${user} -d ${database} -tAc "${query}"`, { cwd: apiDir })
  } else {
    const url = databaseUrl(apiDir)
    if (!url) return 'unknown'
    result = run(`psql "${url}" -tAc "${query}"`, { cwd: apiDir })
  }

  if (result.code !== 0) return 'unknown'
  const count = Number(result.stdout.trim())
  if (!Number.isFinite(count)) return 'unknown'
  return count > 0
}

async function startDevServices(projectName: string, apiDir: string, port: number, dryRun: boolean): Promise<StepResult> {
  const compose = path.join(apiDir, 'docker-compose.dev-services.yml')
  if (!fs.existsSync(compose)) return skipped(`no dev-services compose at ${compose} — this project does not host its own database`)

  // `docker compose up -d` succeeds on a container that is already running, so starting
  // unconditionally would report work on a project where none was needed — and "nothing to
  // finish" is the answer this command owes a healthy project.
  if (await canConnect(port)) return skipped(`already answering on ${port}`)

  if (dryRun) return done(`would run: docker compose -f ${compose} up -d db-dev`)

  // The network may already exist; that is a success for our purposes, not a failure.
  run(`docker network create ${projectName}-network`)

  const result = run(`docker compose -f ${compose} up -d db-dev`)
  if (result.code !== 0) return blocked(`could not start the database container:\n${(result.stderr || result.stdout).trim()}`)
  return done('database container up')
}

async function setUpDatabase(apiDir: string, projectName: string, port: number, hostedHere: boolean, dryRun: boolean): Promise<StepResult> {
  // A dry run predicts, so it runs the read-only half: reachability and the table count.
  // Only the mutating step is withheld. A dry run that skips the checks announces work on a
  // project that needs none, which is the opposite of what it is for.
  const reachable = await waitForPort(port, dryRun ? 2 : 30)
  if (hostedHere && !reachable) {
    return dryRun ? skipped(`nothing answering on ${port} yet — would set up once the container is running`) : blocked(`the database on ${port} did not accept a connection within 30s`)
  }

  const hasTables = databaseHasTables(apiDir, projectName, hostedHere)

  if (hasTables === 'unknown') {
    return blocked(`could not read the database on ${port} to check whether it holds data.\n  Refusing to run db:setup:dev, which would reset it.`)
  }

  if (hasTables) {
    // Already set up, or set up and since used. Either way the destructive step is wrong.
    return skipped('the database already has tables — db:setup:dev would reset it (`prisma db push --force-reset`)')
  }

  if (dryRun) return done(`would run: npm run db:setup:dev in ${apiDir}`)

  const nvm = getNvmPrefix(apiDir)
  const result = run(`${nvm}npm run db:setup:dev`, { cwd: apiDir, stream: true })
  if (result.code !== 0) return blocked(`db:setup:dev failed (exit ${result.code}) — the output above says why`)
  return done('schema pushed and datasets applied')
}

function installDependencies(projectRoot: string, targets: string[], dryRun: boolean): StepResult {
  const missing = targets.filter((rel) => !fs.existsSync(path.join(projectRoot, rel, 'node_modules')))
  if (missing.length === 0) return skipped('node_modules already present')
  if (dryRun) return done(`would install in: ${missing.join(', ')}`)

  for (const rel of missing) {
    const dir = path.join(projectRoot, rel)
    runRequired(`npm install (${rel})`, `${getNvmPrefix(dir)}npm install --prefix ${dir}`)
  }
  return done(`installed in ${missing.join(', ')}`)
}

function generateOrmClient(apiDir: string, dryRun: boolean): StepResult {
  const generated = path.join(apiDir, 'src', 'generated', 'prisma')
  if (fs.existsSync(generated)) return skipped('client already generated')
  if (dryRun) return done(`would run: npx prisma generate in ${apiDir}`)

  // Deliberately `prisma generate`, not `db:setup:dev`: this path is reached when the
  // database already holds tables, and only the client is missing. Generating is
  // non-destructive; resetting is not.
  const result = run(`${getNvmPrefix(apiDir)}npx prisma generate`, { cwd: apiDir, stream: true })
  if (result.code !== 0) return blocked(`prisma generate failed (exit ${result.code})`)
  return done('client generated')
}

export async function resumeCommand(options: ResumeOptions = {}): Promise<void> {
  const projectRoot = process.cwd()
  const manifest: SaaSFoundryManifest | null = await readManifest(projectRoot)

  if (!manifest) {
    console.error(chalk.red('✗ No .saasfoundry.json here — `sf resume` finishes a generated project, from inside it.'))
    process.exitCode = 1
    return
  }

  const apps = appPaths(manifest)
  if (!apps) {
    console.error(chalk.red(`✗ This is a "${manifest.structure}" project — there is no scaffold setup to finish.`))
    process.exitCode = 1
    return
  }

  // The topology comes from the manifest, never from a directory listing.
  const apiDir = path.join(projectRoot, apps.api)
  const dbPort = manifest.ports?.db ?? DEFAULT_PORTS.db
  const dryRun = options.dryRun === true

  console.log(chalk.cyan(`\n🔧 Finishing the setup of "${manifest.projectName}"${dryRun ? chalk.gray('  (dry run)') : ''}\n`))

  const steps: { label: string; result: StepResult }[] = []

  steps.push({
    label: 'dependencies',
    result: installDependencies(projectRoot, manifest.structure === 'monorepo' ? ['.'] : [apps.api, apps.web], dryRun)
  })

  if (manifest.modules?.dbSetup === 'docker') {
    steps.push({ label: 'dev services', result: await startDevServices(manifest.projectName, apiDir, dbPort, dryRun) })
  } else {
    steps.push({ label: 'dev services', result: skipped(`dbSetup is "${manifest.modules?.dbSetup ?? 'unset'}" — this project does not host its own database`) })
  }

  const servicesBlocked = steps.some((s) => s.result.outcome === 'blocked')
  if (!servicesBlocked && manifest.modules?.dbSetup !== 'manual') {
    steps.push({ label: 'database setup', result: await setUpDatabase(apiDir, manifest.projectName, dbPort, manifest.modules?.dbSetup === 'docker', dryRun) })
  }

  steps.push({ label: 'ORM client', result: generateOrmClient(apiDir, dryRun) })

  for (const { label, result } of steps) {
    const mark = result.outcome === 'done' ? chalk.green('✓') : result.outcome === 'skipped' ? chalk.gray('·') : chalk.red('✗')
    const text = result.outcome === 'blocked' ? chalk.red(result.message) : result.outcome === 'skipped' ? chalk.gray(result.message) : result.message
    console.log(`  ${mark} ${chalk.bold(label.padEnd(16))} ${text}`)
  }

  const blockedSteps = steps.filter((s) => s.result.outcome === 'blocked')
  const changed = steps.filter((s) => s.result.outcome === 'done')

  console.log()
  if (blockedSteps.length > 0) {
    console.log(chalk.red(`✗ ${blockedSteps.length} step${blockedSteps.length === 1 ? '' : 's'} could not complete. Nothing else was attempted after them.`))
    process.exitCode = 1
    return
  }
  if (changed.length === 0) {
    console.log(chalk.green('✓ Nothing to finish — this project is already set up.'))
    return
  }
  console.log(chalk.green(`✓ Setup finished. Run \`sf status\` to confirm, then \`npm run dev\`.`))
}
