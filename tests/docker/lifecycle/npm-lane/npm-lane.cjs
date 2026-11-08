'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- run by plain node outside the tsx runtime, so CommonJS. */

/**
 * The lane's `npm`, first on the lifecycle container's PATH (#1198).
 *
 * The generated project's installs do not run in the lane's code: `sf new` and `sf update`
 * shell out to `npm install` inside the CLI. The lifecycle passes only an allowlisted
 * environment to the CLI, so npm settings set on the lane never reached those installs, and
 * a registry reset or a stalled install failed the scenario, or held it until the 1800 s
 * budget expired. Every `npm` the container runs comes through here instead:
 *
 * - each command gets the lane's fetch retries and timeouts, unless the caller set them;
 * - `install` and `ci` run under a per-install budget, well under the scenario budget, and a
 *   stalled one is stopped with a message that names it an environment failure;
 * - an install that failed on a transient network error is run once more.
 *
 * Nothing here is shipped to generated projects: the file exists only in the test image.
 */

const { spawn } = require('node:child_process')
const { accessSync, constants, realpathSync } = require('node:fs')
const { delimiter, join } = require('node:path')

/** npm's fetch settings for the lane. Mirrored by NPM_NETWORK_RETRY_ENV in npm-network.ts. */
const LANE_NPM_ENV = Object.freeze({
  npm_config_fetch_retries: '5',
  npm_config_fetch_retry_mintimeout: '10000',
  npm_config_fetch_retry_maxtimeout: '60000',
  npm_config_fetch_timeout: '120000',
  npm_config_update_notifier: 'false'
})

/**
 * The generated web's postinstall runs `npx playwright install --with-deps` when CI=true: 183 MiB
 * of browsers from Playwright's CDN plus apt, inside every `sf new`, which is what stalled the lane
 * (#1198). PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD does not stop an explicit install. The lane drives the
 * browsers the image carries (live-suite.ts), so it uses the switch the generated scripts honour.
 */
const LANE_INSTALL_ENV = Object.freeze({
  SF_SKIP_PLAYWRIGHT_INSTALL: '1'
})

/** Ten minutes: a loaded machine installs a generated monorepo in four to five. */
const DEFAULT_INSTALL_TIMEOUT_MS = 600_000
const DEFAULT_INSTALL_ATTEMPTS = 2
const KILL_GRACE_MS = 10_000
const OUTPUT_TAIL_BYTES = 64 * 1024

/** The marker the lane reads to report an environment failure rather than a product one. */
const ENVIRONMENT_FAILURE_MARKER = 'npm-lane: environment failure'
const TRANSIENT_NETWORK_ERROR = /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED)\b|network aborted|socket hang up/
const INSTALL_COMMANDS = new Set(['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall', 'add', 'ci', 'clean-install', 'ic', 'install-clean', 'isntall-clean'])

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** The first argument that is not an option: npm's command. */
function npmCommand(args) {
  return args.find((arg) => !arg.startsWith('-'))
}

function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function canonical(dir) {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

/** The real npm: SF_LANE_REAL_NPM, or the first `npm` on PATH that is not this wrapper. */
function resolveRealNpm(env, ownDir) {
  if (env.SF_LANE_REAL_NPM) return env.SF_LANE_REAL_NPM
  const own = canonical(ownDir)
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir || canonical(dir) === own) continue
    const candidate = join(dir, 'npm')
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

function laneEnvironment(env) {
  const next = { ...env }
  for (const [name, value] of Object.entries({ ...LANE_NPM_ENV, ...LANE_INSTALL_ENV })) {
    if (next[name] === undefined || next[name] === '') next[name] = value
  }
  return next
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Already gone.
    }
  }
}

/** One run of the real npm. Streams its output and keeps a tail to classify a failure. */
function runOnce(realNpm, args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(realNpm, args, { env, stdio: ['inherit', 'pipe', 'pipe'], detached: true })
    let tail = ''
    let timedOut = false
    let killTimer
    const keep = (chunk) => {
      tail = (tail + chunk.toString('utf8')).slice(-OUTPUT_TAIL_BYTES)
    }
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      keep(chunk)
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      keep(chunk)
    })
    const forward = (signal) => killGroup(child, signal)
    process.on('SIGTERM', forward)
    process.on('SIGINT', forward)
    const budget =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            killGroup(child, 'SIGTERM')
            killTimer = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS)
          }, timeoutMs)
    const settle = (code, signal, spawnError) => {
      clearTimeout(budget)
      clearTimeout(killTimer)
      process.off('SIGTERM', forward)
      process.off('SIGINT', forward)
      resolve({ code, signal, timedOut, tail, spawnError })
    }
    child.once('error', (error) => settle(null, null, error))
    child.once('close', (code, signal) => settle(code, signal))
  })
}

async function main(args, env = process.env, ownDir = __dirname) {
  const realNpm = resolveRealNpm(env, ownDir)
  if (!realNpm) {
    process.stderr.write(`${ENVIRONMENT_FAILURE_MARKER}: no npm found on PATH besides the lane wrapper in ${ownDir}.\n`)
    return 127
  }
  const childEnv = laneEnvironment(env)
  const command = npmCommand(args)
  if (!INSTALL_COMMANDS.has(command)) {
    const result = await runOnce(realNpm, args, childEnv, undefined)
    if (result.spawnError) {
      process.stderr.write(`${ENVIRONMENT_FAILURE_MARKER}: npm could not start: ${result.spawnError.message}\n`)
      return 127
    }
    return result.code ?? 1
  }

  const timeoutMs = positiveInteger(env.SF_LANE_NPM_INSTALL_TIMEOUT_MS, DEFAULT_INSTALL_TIMEOUT_MS)
  const attempts = positiveInteger(env.SF_LANE_NPM_INSTALL_ATTEMPTS, DEFAULT_INSTALL_ATTEMPTS)
  for (let attempt = 1; ; attempt++) {
    const result = await runOnce(realNpm, args, childEnv, timeoutMs)
    if (result.spawnError) {
      process.stderr.write(`${ENVIRONMENT_FAILURE_MARKER}: npm ${command} could not start: ${result.spawnError.message}\n`)
      return 127
    }
    if (result.timedOut) {
      // Not retried: a second stall would take the rest of the scenario budget with it.
      process.stderr.write(
        `${ENVIRONMENT_FAILURE_MARKER}: npm ${command} in ${process.cwd()} did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped. ` +
          'A download or install script stalled; this is an environment failure, not a product one (#1198).\n'
      )
      return 124
    }
    if (result.code === 0) return 0
    if (attempt >= attempts || !TRANSIENT_NETWORK_ERROR.test(result.tail)) return result.code ?? 1
    process.stderr.write(`npm-lane: npm ${command} failed on a transient network error; running it again (attempt ${attempt + 1} of ${attempts}).\n`)
  }
}

module.exports = { DEFAULT_INSTALL_TIMEOUT_MS, ENVIRONMENT_FAILURE_MARKER, LANE_INSTALL_ENV, LANE_NPM_ENV, laneEnvironment, main, npmCommand, resolveRealNpm }

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${ENVIRONMENT_FAILURE_MARKER}: the lane npm wrapper crashed: ${error && error.stack ? error.stack : String(error)}\n`)
      process.exit(1)
    }
  )
}
