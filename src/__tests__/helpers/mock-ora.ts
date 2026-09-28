/**
 * Mock ora to return a silent spinner.
 * Must be called before importing modules that use ora.
 */
export function mockOra(): void {
  jest.mock('ora', () => {
    return () => ({
      start: jest.fn().mockReturnThis(),
      stop: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
      warn: jest.fn().mockReturnThis(),
      info: jest.fn().mockReturnThis(),
      text: '',
      isSpinning: false
    })
  })
}
