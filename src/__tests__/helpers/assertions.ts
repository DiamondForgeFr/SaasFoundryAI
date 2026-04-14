import { readFile, access, constants } from 'fs/promises'

/**
 * Assert that a file exists at the given path.
 */
export async function expectFileExists(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK)
  } catch {
    throw new Error(`Expected file to exist: ${filePath}`)
  }
}

/**
 * Assert that a file does NOT exist at the given path.
 */
export async function expectFileNotExists(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK)
    throw new Error(`Expected file NOT to exist: ${filePath}`)
  } catch (error) {
    if ((error as Error).message.startsWith('Expected file NOT to exist')) throw error
    // File doesn't exist — that's what we want
  }
}

/**
 * Assert that a file contains a specific substring.
 */
export async function expectFileContains(filePath: string, substring: string): Promise<void> {
  const content = await readFile(filePath, 'utf8')
  if (!content.includes(substring)) {
    throw new Error(`Expected file ${filePath} to contain "${substring}", but it doesn't.\nFile content (first 500 chars):\n${content.slice(0, 500)}`)
  }
}

/**
 * Assert that a file does NOT contain a specific substring.
 */
export async function expectFileNotContains(filePath: string, substring: string): Promise<void> {
  const content = await readFile(filePath, 'utf8')
  if (content.includes(substring)) {
    throw new Error(`Expected file ${filePath} NOT to contain "${substring}", but it does.`)
  }
}

/**
 * Assert that all TODO markers for a given module have been removed (module activated).
 */
export async function expectNoTodoMarkers(filePath: string, markerName: string): Promise<void> {
  const content = await readFile(filePath, 'utf8')
  const pattern = `// TODO ${markerName}: `
  if (content.includes(pattern)) {
    throw new Error(`Expected no TODO markers "${markerName}" in ${filePath}, but found some.`)
  }
}

/**
 * Assert that TODO markers for a given module are still present (module NOT activated).
 */
export async function expectTodoMarkersPresent(filePath: string, markerName: string): Promise<void> {
  const content = await readFile(filePath, 'utf8')
  const pattern = `// TODO ${markerName}: `
  if (!content.includes(pattern)) {
    throw new Error(`Expected TODO markers "${markerName}" in ${filePath}, but found none.`)
  }
}

/**
 * Assert that a .env file contains a specific variable with a specific value.
 */
export async function expectEnvVar(envPath: string, key: string, value: string): Promise<void> {
  const content = await readFile(envPath, 'utf8')
  const expected = `${key}="${value}"`
  if (!content.includes(expected)) {
    // Also try without quotes
    const altExpected = `${key}=${value}`
    if (!content.includes(altExpected)) {
      throw new Error(`Expected ${envPath} to contain ${key}="${value}", but it doesn't.\nContent:\n${content}`)
    }
  }
}

/**
 * Assert that a .env variable is still commented out.
 */
export async function expectEnvVarCommented(envPath: string, key: string): Promise<void> {
  const content = await readFile(envPath, 'utf8')
  const regex = new RegExp(`^# ${key}=`, 'm')
  if (!regex.test(content)) {
    throw new Error(`Expected ${key} to be commented out in ${envPath}, but it's not.`)
  }
}

/**
 * Assert that package.json contains a dependency.
 */
export async function expectPackageJsonDep(pkgPath: string, depName: string, depType: 'dependencies' | 'devDependencies' = 'dependencies'): Promise<void> {
  const content = JSON.parse(await readFile(pkgPath, 'utf8'))
  if (!content[depType] || !content[depType][depName]) {
    throw new Error(`Expected ${pkgPath} to have ${depType}.${depName}, but it doesn't.`)
  }
}

/**
 * Assert that a YAML string is valid.
 */
export function expectValidYaml(content: string): void {
  const yaml = require('js-yaml')
  try {
    yaml.load(content)
  } catch (error) {
    throw new Error(`Expected valid YAML, but parsing failed: ${(error as Error).message}\nContent:\n${content.slice(0, 500)}`)
  }
}
