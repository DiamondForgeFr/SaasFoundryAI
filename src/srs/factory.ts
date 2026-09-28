import { SrsAdapter } from '../builders/srs/types'
import { getSrsBackend, listSrsBackends } from './registry'

export type SrsConfigErrorCode = 'missing' | 'unknown'

export class SrsConfigError extends Error {
  readonly code: SrsConfigErrorCode

  constructor(code: SrsConfigErrorCode, message: string) {
    super(message)
    this.name = 'SrsConfigError'
    this.code = code
  }
}

export interface SrsManifestSubset {
  tools?: {
    srs?: {
      backend?: string
      scan?: {
        exclude?: string[]
      }
    }
  }
}

export async function createSrsAdapter(manifest: SrsManifestSubset): Promise<SrsAdapter> {
  const backend = manifest.tools?.srs?.backend
  if (!backend) {
    throw new SrsConfigError('missing', 'createSrsAdapter: `.saasfoundry.json → tools.srs.backend` is not set. Example: { "tools": { "srs": { "backend": "notion", "enabled": true } } }.')
  }
  const factory = getSrsBackend(backend)
  if (!factory) {
    const available = listSrsBackends()
    const hint = available.length > 0 ? available.join(', ') : '<none registered>'
    throw new SrsConfigError('unknown', `createSrsAdapter: unknown SRS backend "${backend}". Available: ${hint}.`)
  }
  return Promise.resolve(factory())
}
