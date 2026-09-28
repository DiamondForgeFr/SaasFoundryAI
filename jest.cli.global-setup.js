const { execFileSync } = require('node:child_process')

module.exports = function compileCliForTests() {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', 'tsconfig.json'], {
    cwd: __dirname,
    stdio: ['ignore', 'inherit', 'inherit']
  })
}
