const { spawnSync } = require('node:child_process')

const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error('npm_execpath is unavailable; run this check through npm run package:check.')
  process.exit(1)
}

const prepared = spawnSync(process.execPath, [npmCli, 'run', 'package:prepare'], { encoding: 'utf8', stdio: 'inherit' })
if (prepared.status !== 0) process.exit(prepared.status || 1)

const packed = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' })
if (packed.status !== 0) {
  process.stderr.write(packed.stderr)
  process.exit(packed.status || 1)
}

let report
try {
  const candidates = [...packed.stdout.matchAll(/^\[\s*\{/gm)]
  const jsonStart = candidates.at(-1)?.index ?? -1
  if (jsonStart < 0) throw new Error('missing JSON array')
  report = JSON.parse(packed.stdout.slice(jsonStart))
} catch {
  console.error('npm pack did not return a JSON report.')
  process.exit(1)
}

const packageReport = report[0]
const files = new Set((packageReport?.files || []).map((entry) => entry.path))
const required = ['bin/sf.js', 'dist/index.js', 'docs-dist/index.html']
const missing = required.filter((file) => !files.has(file))
const compiledTests = [...files].filter((file) => file.startsWith('dist/__tests__/'))
const scaffoldCount = [...files].filter((file) => file.startsWith('scaffolds/')).length
// npm silently drops some names when it packs (every `.gitignore`, among others), and the
// 1.0.0 package shipped without its three `.gitignore` templates (#875). Every tracked
// scaffold file must reach the package, whatever rule dropped it.
const tracked = spawnSync('git', ['ls-files', '-z', 'scaffolds'], { encoding: 'utf8' })
if (tracked.status !== 0) {
  process.stderr.write(tracked.stderr)
  console.error('Could not list the tracked scaffold files.')
  process.exit(1)
}
const unpublishedScaffolds = tracked.stdout.split('\0').filter((file) => file && !files.has(file))
const forbiddenFixtureArtifacts = [...files].filter(
  (file) =>
    file.startsWith('tests/') ||
    /(^|\/)(?:__fixtures__|fixtures|previous-release|legacy-beta)(\/|$)/.test(file) ||
    /(^|\/)scripts\/refresh-previous-release-fixture\.[^/]+$/i.test(file) ||
    /\.(?:gz|tgz|tar|zip)$/i.test(file)
)

// These ceilings deliberately leave substantial room above the current package.
// They catch an accidentally published project fixture or build tree while keeping
// ordinary documentation and scaffold growth reviewable instead of brittle.
const packageBudgets = {
  size: 8 * 1024 * 1024,
  unpackedSize: 24 * 1024 * 1024,
  entryCount: 2000
}
const invalidReportFields = Object.keys(packageBudgets).filter((field) => !Number.isSafeInteger(packageReport?.[field]) || packageReport[field] < 0)
const exceededBudgets = Object.entries(packageBudgets).filter(([field, maximum]) => Number.isSafeInteger(packageReport?.[field]) && packageReport[field] > maximum)

if (missing.length || unpublishedScaffolds.length || compiledTests.length || forbiddenFixtureArtifacts.length || scaffoldCount === 0 || invalidReportFields.length || exceededBudgets.length) {
  if (missing.length) console.error(`Missing required package files: ${missing.join(', ')}`)
  if (unpublishedScaffolds.length) console.error(`Tracked scaffold files npm would not publish: ${unpublishedScaffolds.join(', ')}`)
  if (compiledTests.length) console.error(`Compiled tests leaked into the package: ${compiledTests.length}`)
  if (forbiddenFixtureArtifacts.length) console.error(`Test fixture or archive files leaked into the package: ${forbiddenFixtureArtifacts.join(', ')}`)
  if (scaffoldCount === 0) console.error('No scaffold files were included in the package.')
  if (invalidReportFields.length) console.error(`npm pack omitted valid package metrics: ${invalidReportFields.join(', ')}`)
  for (const [field, maximum] of exceededBudgets) {
    console.error(`Package ${field} exceeds the review budget: ${packageReport[field]} > ${maximum}`)
  }
  process.exit(1)
}

console.log(
  `Package boundary valid: ${packageReport.entryCount} files, ${packageReport.size} bytes packed, ${packageReport.unpackedSize} bytes unpacked, ${scaffoldCount} scaffold files, no test fixtures.`
)
