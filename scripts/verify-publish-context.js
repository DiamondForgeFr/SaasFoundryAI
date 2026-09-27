const { version } = require('../package.json')

const expectedRef = `refs/tags/v${version}`
const failures = []

if (process.env.GITHUB_ACTIONS !== 'true') failures.push('publication must run in GitHub Actions')
if (process.env.GITHUB_REF !== expectedRef) failures.push(`GITHUB_REF must be ${expectedRef}`)

if (failures.length > 0) {
  console.error('Stable package publication is restricted to .github/workflows/publish-stable.yml:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Verified protected publish context for v${version}.`)
