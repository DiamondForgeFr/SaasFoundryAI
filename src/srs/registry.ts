import { SrsAdapter } from '../builders/srs/types'

export type SrsAdapterFactory = () => SrsAdapter | Promise<SrsAdapter>

const registry = new Map<string, SrsAdapterFactory>()

export function registerSrsBackend(key: string, factory: SrsAdapterFactory): void {
  registry.set(key, factory)
}

export function unregisterSrsBackend(key: string): void {
  registry.delete(key)
}

export function getSrsBackend(key: string): SrsAdapterFactory | undefined {
  return registry.get(key)
}

export function listSrsBackends(): string[] {
  return Array.from(registry.keys()).sort()
}
