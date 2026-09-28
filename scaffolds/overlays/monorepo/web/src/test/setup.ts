/**
 * Vitest setup — unmounts the React tree rendered by @testing-library/react after every test so
 * the jsdom DOM stays isolated between cases. Imported via `setupFiles` in vitest.config.ts.
 */
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
