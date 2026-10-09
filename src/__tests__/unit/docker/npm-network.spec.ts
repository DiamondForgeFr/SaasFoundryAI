import { isTransientNpmNetworkError, NPM_NETWORK_RETRY_ENV, withNpmNetworkRetry } from '../../../../tests/docker/lifecycle/npm-network'

// #908 — a registry reset failed the lifecycle lane, green on every rerun
describe('lifecycle npm network retry', () => {
  const reset = new Error('after-update api npm ci exited unsuccessfully (status=1).\nstderr:\nnpm error code ECONNRESET\nnpm error network aborted')

  it('recognises the transient network errors, and nothing else', () => {
    expect(isTransientNpmNetworkError(reset)).toBe(true)
    expect(isTransientNpmNetworkError(new Error('npm error code ETIMEDOUT'))).toBe(true)
    expect(isTransientNpmNetworkError(new Error('getaddrinfo EAI_AGAIN registry.npmjs.org'))).toBe(true)
    expect(isTransientNpmNetworkError(new Error('npm error code ERESOLVE could not resolve'))).toBe(false)
  })

  it('runs the command again after a network reset', async () => {
    const attempt = jest.fn().mockRejectedValueOnce(reset).mockResolvedValueOnce('ok')
    await expect(withNpmNetworkRetry(attempt)).resolves.toBe('ok')
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('fails at once on any other error, and after the last attempt on a network one', async () => {
    const other = jest.fn().mockRejectedValue(new Error('npm error code ERESOLVE'))
    await expect(withNpmNetworkRetry(other)).rejects.toThrow('ERESOLVE')
    expect(other).toHaveBeenCalledTimes(1)

    const always = jest.fn().mockRejectedValue(reset)
    await expect(withNpmNetworkRetry(always, 3)).rejects.toThrow('ECONNRESET')
    expect(always).toHaveBeenCalledTimes(3)
  })

  it('gives npm more fetch attempts than its default of 2', () => {
    expect(Number(NPM_NETWORK_RETRY_ENV.npm_config_fetch_retries)).toBeGreaterThan(2)
  })
})
