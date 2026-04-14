import shelljs from 'shelljs'

/**
 * Mock shelljs.exec to no-op and return success.
 * Returns the spy so tests can assert on calls.
 */
export function mockShellExec(): jest.SpyInstance {
  const spy = jest.spyOn(shelljs, 'exec').mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (() => ({ code: 0, stdout: '10.0.0', stderr: '' })) as any
  )
  return spy
}

/**
 * Mock child_process.execSync to no-op.
 */
export function mockExecSync(): void {
  jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execSync: jest.fn().mockReturnValue(Buffer.from(''))
  }))
}

/**
 * Restore all shell mocks.
 */
export function restoreShellMocks(spy: jest.SpyInstance): void {
  spy.mockRestore()
}
