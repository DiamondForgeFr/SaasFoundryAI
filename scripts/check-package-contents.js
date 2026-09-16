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
  const jsonStart = packed.stdout.search(/^\[/m)
  report = JSON.parse(packed.stdout.slice(jsonStart))
} catch {
  console.error('npm pack did not return a JSON report.')
  process.exit(1)
}

const files = new Set((report[0]?.files || []).map((entry) => entry.path))
const required = ['bin/sf.js', 'dist/index.js', 'docs-dist/index.html']
const missing = required.filter((file) => !files.has(file))
const compiledTests = [...files].filter((file) => file.startsWith('dist/__tests__/'))
const scaffoldCount = [...files].filter((file) => file.startsWith('scaffolds/')).length

if (missing.length || compiledTests.length || scaffoldCount === 0) {
  if (missing.length) console.error(`Missing required package files: ${missing.join(', ')}`)
  if (compiledTests.length) console.error(`Compiled tests leaked into the package: ${compiledTests.length}`)
  if (scaffoldCount === 0) console.error('No scaffold files were included in the package.')
  process.exit(1)
}

console.log(`Package boundary valid: ${files.size} files, ${scaffoldCount} scaffold files, no compiled tests.`)
