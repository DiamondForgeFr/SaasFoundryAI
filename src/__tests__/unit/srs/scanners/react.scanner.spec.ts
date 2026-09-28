import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { extractFormFields, extractRoutes, reactScanner } from '../../../../srs/scanners/react.scanner'
import { CodebaseScannerContext, UiFlowFinding } from '../../../../srs/scanners/types'

function walkSync(root: string): string[] {
  const out: string[] = []
  const visit = (abs: string): void => {
    for (const entry of readdirSync(abs)) {
      const child = join(abs, entry)
      const st = statSync(child)
      if (st.isDirectory()) visit(child)
      else if (st.isFile()) out.push(relative(root, child).split('\\').join('/'))
    }
  }
  visit(root)
  return out
}

describe('extractRoutes (pure)', () => {
  it('maps component names to paths from a router config', () => {
    const source = `
      export const routes = [
        { path: '/login', element: LazyRouteElement(LoginPage) },
        { path: '/dashboard', element: LazyRouteElement(DashboardPage), guard: true }
      ]
    `
    const map = extractRoutes(source)
    expect(map.get('LoginPage')).toBe('/login')
    expect(map.get('DashboardPage')).toBe('/dashboard')
  })

  it('keeps the first occurrence when a component is referenced twice', () => {
    const source = `
      { path: '/first', element: LazyRouteElement(Dup) },
      { path: '/second', element: LazyRouteElement(Dup) }
    `
    const map = extractRoutes(source)
    expect(map.get('Dup')).toBe('/first')
  })
})

describe('extractFormFields (pure)', () => {
  it('collects keys from defaultValues, name="..." and register("...")', () => {
    const source = `
      const form = useForm({
        defaultValues: {
          email: '',
          password: ''
        }
      })
      return (
        <form>
          <input name="email" />
          <input {...register('password')} />
          <input name="remember" />
        </form>
      )
    `
    const fields = extractFormFields(source)
    expect(fields).toEqual(['email', 'password', 'remember'])
  })

  it('collects keys from a zod schema', () => {
    const source = `
      const schema = z.object({
        firstName: z.string(),
        lastName: z.string().optional(),
        age: z.number()
      })
    `
    const fields = extractFormFields(source)
    expect(fields).toEqual(['age', 'firstName', 'lastName'])
  })
})

describe('reactScanner.collect', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-react-'))
  })

  const seedFile = (absPath: string, source: string): void => {
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, source)
  }

  it('emits ui-flow findings with route + formFields for a monorepo web/', async () => {
    const webRoot = join(tmp, 'web')
    seedFile(
      join(webRoot, 'src', 'router', 'routes.tsx'),
      `
      export const routes = [
        { path: '/login', element: LazyRouteElement(LoginPage) }
      ]
    `
    )
    seedFile(
      join(webRoot, 'src', 'pages', 'public', 'LoginPage.tsx'),
      `
      export function LoginPage() {
        const form = useForm({
          defaultValues: { email: '', password: '' }
        })
        return <form><input name="email" /><input name="password" /></form>
      }
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo',
      webRoot
    }

    const findings = (await reactScanner.collect(context)) as UiFlowFinding[]

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'ui-flow',
      title: 'LoginPage (public/LoginPage)',
      area: 'public/LoginPage',
      file: 'web/src/pages/public/LoginPage.tsx',
      route: '/login',
      formFields: ['email', 'password'],
      linkedEndpointGuess: 'login'
    })
  })

  it('emits ui-flow findings in a multirepo layout (scanRoot-rooted web)', async () => {
    seedFile(
      join(tmp, 'src', 'router', 'app.tsx'),
      `
      const ROUTES = [
        { path: '/users/profile', element: LazyRouteElement(UserProfile) }
      ]
    `
    )
    seedFile(
      join(tmp, 'src', 'pages', 'private', 'UserProfile.tsx'),
      `
      export default function UserProfile() {
        return <div>Profile</div>
      }
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'multirepo',
      webRoot: tmp
    }

    const findings = (await reactScanner.collect(context)) as UiFlowFinding[]

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'ui-flow',
      title: 'UserProfile (private/UserProfile)',
      area: 'private/UserProfile',
      file: 'src/pages/private/UserProfile.tsx',
      route: '/users/profile',
      formFields: [],
      linkedEndpointGuess: 'users'
    })
  })

  it('leaves route/linkedEndpointGuess undefined when no router matches the component', async () => {
    seedFile(
      join(tmp, 'web', 'src', 'pages', 'private', 'OrphanPage.tsx'),
      `
      export function OrphanPage() {
        return <div />
      }
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo',
      webRoot: join(tmp, 'web')
    }

    const findings = (await reactScanner.collect(context)) as UiFlowFinding[]

    expect(findings).toHaveLength(1)
    expect(findings[0].route).toBeUndefined()
    expect(findings[0].linkedEndpointGuess).toBeUndefined()
  })

  it('ignores .spec.tsx and .test.tsx files', async () => {
    seedFile(join(tmp, 'web', 'src', 'pages', 'public', 'LoginPage.spec.tsx'), `export function LoginPage() { return null }`)
    seedFile(join(tmp, 'web', 'src', 'pages', 'public', 'LoginPage.test.tsx'), `export function LoginPage() { return null }`)

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo',
      webRoot: join(tmp, 'web')
    }

    const findings = await reactScanner.collect(context)
    expect(findings).toEqual([])
  })

  it('returns [] when no pages exist', async () => {
    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: [],
      structure: 'monorepo',
      webRoot: join(tmp, 'web')
    }
    const findings = await reactScanner.collect(context)
    expect(findings).toEqual([])
  })
})
