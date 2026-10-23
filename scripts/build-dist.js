// Compiles the CLI next to dist/ and swaps it in, instead of deleting dist/
// and recompiling in place. The local CI runs the build beside the jest
// projects whose global setup compiles and then reads dist/: an in-place
// clean left them without modules for the whole compilation.
const { spawnSync } = require('node:child_process')
const { mkdirSync, renameSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const dist = join(root, 'dist')
// Named dist so the format and lint ignores already cover it while tsc writes it.
const staging = join(root, '.tmp', `build-${process.pid}`)
const next = join(staging, 'dist')
const previous = join(staging, 'previous')

rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

try {
  const compiled = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', join(root, 'tsconfig.json'), '--outDir', next], {
    cwd: root,
    stdio: 'inherit'
  })
  if (compiled.status !== 0) process.exitCode = compiled.status || 1
  else {
    try {
      renameSync(dist, previous)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    renameSync(next, dist)
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}
