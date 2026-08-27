import crypto from 'crypto'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

import { DbCredentials, SaaSFoundryManifest } from './types'

/**
 * Patterns to ignore when computing file hashes for the manifest.
 * These files are either auto-generated, contain secrets, or are not managed by SaaSFoundryAI.
 */
const HASH_IGNORE_PATTERNS = ['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '.env', '.env.test', 'package-lock.json', '.saasfoundry.json', '.DS_Store', '.saasfoundry.new']

/**
 * Check if a file path should be ignored for hash computation.
 */
function shouldIgnore(filePath: string): boolean {
  const parts = filePath.split(path.sep)
  // `.saasfoundry.new` sidecars are conflict artifacts, never templates —
  // hashing them would pollute the baseline after a conflicted update.
  return parts.some((part) => HASH_IGNORE_PATTERNS.includes(part) || part.endsWith('.saasfoundry.new'))
}

/**
 * Compute SHA-256 hash of a file's content.
 */
export function hashFileContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Walk a directory recursively and compute SHA-256 hashes for all tracked files.
 * Returns a map of relative file paths to their hashes.
 */
export async function computeFileHashes(dir: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {}

  async function walk(currentDir: string) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      const relativePath = path.relative(dir, fullPath)

      if (shouldIgnore(relativePath)) continue

      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const content = await fs.promises.readFile(fullPath, 'utf8')
        hashes[relativePath] = hashFileContent(content)
      }
    }
  }

  await walk(dir)
  return hashes
}

/**
 * Floor for the CLI's own runtime, and the fallback for a project that declares nothing.
 *
 * It is NOT the version a generated project runs on — that project says so itself, in its
 * `.nvmrc`, and today it says 24. Node 22 ships npm 10.9.7 while the generated
 * `package.json` demands `npm >= 11` with `onFail: "error"`, so driving a generated
 * project from this constant makes every `npm run` refuse to start. See #589.
 */
const REQUIRED_NODE_MAJOR = 22

/**
 * The Node version a project asks for, read from the nearest `.nvmrc` at or above `dir`.
 *
 * Returns null when there is none, which is the signal to fall back rather than to guess.
 */
export function resolveProjectNodeVersion(dir: string): string | null {
  let current = path.resolve(dir)
  // Stop at the filesystem root; `dirname('/')` is `/`, which is the loop's own guard.
  for (;;) {
    const candidate = path.join(current, '.nvmrc')
    if (fs.existsSync(candidate)) {
      const version = fs.readFileSync(candidate, 'utf8').trim()
      if (version) return version
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Returns a shell prefix that loads nvm and switches to the Node version the target
 * project declares. Falls back silently if nvm is not available (the user may already
 * have the right version).
 *
 * Pass the directory the command will run in. Without it — or when that directory
 * declares nothing — the CLI's own floor is used, which is what every caller did before
 * `.nvmrc` was allowed to have an opinion.
 */
export function getNvmPrefix(targetDir?: string): string {
  const requested = targetDir ? resolveProjectNodeVersion(targetDir) : null
  const version = requested || String(REQUIRED_NODE_MAJOR)
  return `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use ${version} --silent 2>/dev/null; `
}

/**
 * Check that the required Node.js version is available (either active or via nvm).
 * Throws with a clear message if not.
 */
export function checkNodeVersion(): void {
  const currentMajor = parseInt(process.versions.node.split('.')[0], 10)
  if (currentMajor >= REQUIRED_NODE_MAJOR) return

  // Current Node is too old — check if nvm can help
  try {
    const result = execSync(`export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm ls ${REQUIRED_NODE_MAJOR} 2>/dev/null`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    if (result && !result.includes('N/A')) return // nvm has Node 22 available
  } catch {
    // nvm not available or Node 22 not installed
  }

  throw new Error(
    `Node.js >= ${REQUIRED_NODE_MAJOR} is required (current: ${process.versions.node}).\n` +
      `Please install Node ${REQUIRED_NODE_MAJOR} via nvm:\n` +
      `  nvm install ${REQUIRED_NODE_MAJOR}\n` +
      `  nvm use ${REQUIRED_NODE_MAJOR}`
  )
}

/**
 * Validate that a project name is safe for use in shell commands and file paths
 */
export function validateProjectName(name: string): void {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`Invalid project name "${name}": can only contain lowercase letters, numbers, and hyphens`)
  }
}

/**
 * Generate a secure random string for JWT secrets
 * @param length Length of the secret (default: 64)
 * @returns A secure random string
 */
export function generateJwtSecret(length: number = 64): string {
  return crypto.randomBytes(length).toString('hex')
}

/**
 * Set default values for database credentials if they are empty
 */
export function setDefaultDbCredentials(credentials?: DbCredentials): DbCredentials | undefined {
  if (!credentials) return undefined

  // define db type first
  const dbType = credentials.dbType || 'postgresql'

  return {
    dbType,
    host: credentials.host || 'localhost',
    port: credentials.port || (dbType === 'postgresql' ? '5435' : '1433'),
    user: credentials.user || 'db_dev_user',
    password: credentials.password || 'db_dev_password',
    database: credentials.database || 'db_dev'
  }
}

/**
 * Apply regex replacements to a file, skipping it when it does not exist.
 *
 * Overlay-driven scaffolds do not materialise every file on every topology, and a
 * substitution that throws on a missing file would make the port pass topology-aware
 * for no reason.
 */
export async function replaceInFile(filePath: string, replacements: [RegExp, string][]): Promise<void> {
  if (!(await fileExists(filePath))) return
  let content = await fs.promises.readFile(filePath, 'utf8')
  for (const [pattern, replacement] of replacements) content = content.replace(pattern, replacement)
  await fs.promises.writeFile(filePath, content, 'utf8')
}

/**
 * Replace `{{KEY}}` placeholders in the given files with the supplied values.
 * Files that do not exist are skipped silently — overlay-driven scaffolds may
 * not always materialise every targeted file.
 */
export async function substitutePlaceholdersInFiles(filePaths: string[], replacements: Record<string, string>): Promise<void> {
  for (const filePath of filePaths) {
    if (!(await fileExists(filePath))) continue
    let content = await fs.promises.readFile(filePath, 'utf8')
    for (const [key, value] of Object.entries(replacements)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    await fs.promises.writeFile(filePath, content, 'utf8')
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Read the .saasfoundry.json manifest from a project directory
 * Returns null if the file doesn't exist
 */
export async function readManifest(projectPath: string): Promise<SaaSFoundryManifest | null> {
  const manifestPath = path.join(projectPath, '.saasfoundry.json')

  if (!(await fileExists(manifestPath))) {
    return null
  }

  try {
    const content = await fs.promises.readFile(manifestPath, 'utf8')
    return JSON.parse(content) as SaaSFoundryManifest
  } catch (error) {
    console.error(`Error reading manifest: ${error}`)
    return null
  }
}

/**
 * Write the .saasfoundry.json manifest to a project directory
 * Preserves all existing fields and updates only the provided ones
 */
export async function writeManifest(projectPath: string, updates: Partial<SaaSFoundryManifest>): Promise<void> {
  const manifestPath = path.join(projectPath, '.saasfoundry.json')

  // Read existing manifest if it exists
  let manifest: Partial<SaaSFoundryManifest> = {}
  if (await fileExists(manifestPath)) {
    const content = await fs.promises.readFile(manifestPath, 'utf8')
    manifest = JSON.parse(content) as SaaSFoundryManifest
  }

  // Merge updates into existing manifest
  manifest = { ...manifest, ...updates }

  // Write back to file
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}
