import { createHash } from 'node:crypto'

import { stableFingerprint } from './overrides'
import {
  assertAdaptiveExecutionDispatchPermit,
  assertExecutionCloudDispatchManifest,
  type AdaptiveExecutionDispatchPermit,
  type ExecutionCloudContentScope,
  type ExecutionCloudDispatchManifest
} from './route-authority'

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface AdaptiveCloudDispatchPart {
  scope: ExecutionCloudContentScope
  contentRef: string
  bytes: Uint8Array
}

export interface AdaptiveCloudDispatchInput {
  permit: AdaptiveExecutionDispatchPermit
  manifest: ExecutionCloudDispatchManifest
  nodeId: string
  evaluatedAt: string
  parts: AdaptiveCloudDispatchPart[]
}

export interface AdaptiveCloudDispatchAuthority {
  /** Atomically marks the permit as used immediately before network I/O. */
  consumeDispatchPermit(permit: Readonly<AdaptiveExecutionDispatchPermit>, binding: Readonly<{ manifestId: string; nodeId: string; payloadFingerprint: string; evaluatedAt: string }>): boolean
}

export interface AdaptiveCloudDispatchLimits {
  maximumPartBytes: number
  maximumTotalBytes: number
}

export interface AdaptiveCloudTransport<T> {
  send(input: Readonly<{ nodeId: string; parts: readonly AdaptiveCloudDispatchPart[] }>): Promise<T>
}

export class AdaptiveCloudDispatchError extends Error {
  readonly code: 'invalid-dispatch' | 'permit-rejected'

  constructor(code: AdaptiveCloudDispatchError['code'], message: string) {
    super(message)
    this.name = 'AdaptiveCloudDispatchError'
    this.code = code
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function validateLimits(value: unknown): AdaptiveCloudDispatchLimits {
  if (
    !object(value) ||
    Object.keys(value).some((field) => !['maximumPartBytes', 'maximumTotalBytes'].includes(field)) ||
    !Number.isSafeInteger(value.maximumPartBytes) ||
    Number(value.maximumPartBytes) <= 0 ||
    !Number.isSafeInteger(value.maximumTotalBytes) ||
    Number(value.maximumTotalBytes) <= 0 ||
    Number(value.maximumPartBytes) > Number(value.maximumTotalBytes)
  )
    throw new AdaptiveCloudDispatchError('invalid-dispatch', 'Cloud dispatch byte limits are invalid')
  return { maximumPartBytes: Number(value.maximumPartBytes), maximumTotalBytes: Number(value.maximumTotalBytes) }
}

function validateParts(parts: unknown, manifest: ExecutionCloudDispatchManifest, limits: AdaptiveCloudDispatchLimits): { parts: AdaptiveCloudDispatchPart[]; payloadFingerprint: string } {
  if (!Array.isArray(parts) || parts.length !== manifest.parts.length) throw new AdaptiveCloudDispatchError('invalid-dispatch', 'Outbound parts must match the approved manifest exactly')
  let declaredTotal = 0
  for (const part of manifest.parts) {
    if (part.byteLength > limits.maximumPartBytes || declaredTotal > limits.maximumTotalBytes - part.byteLength)
      throw new AdaptiveCloudDispatchError('invalid-dispatch', 'Approved outbound content exceeds the configured byte limits')
    declaredTotal += part.byteLength
  }
  const byKey = new Map(manifest.parts.map((part) => [`${part.scope}/${part.contentRef}`, part]))
  const seen = new Set<string>()
  const normalized: AdaptiveCloudDispatchPart[] = []
  for (const part of parts) {
    if (!object(part) || Object.keys(part).some((field) => !['scope', 'contentRef', 'bytes'].includes(field)) || !(part.bytes instanceof Uint8Array))
      throw new AdaptiveCloudDispatchError('invalid-dispatch', 'Outbound part contract is invalid')
    const key = `${String(part.scope)}/${String(part.contentRef)}`
    const approved = byKey.get(key)
    if (!approved || seen.has(key) || part.bytes.byteLength !== approved.byteLength || sha256(part.bytes) !== approved.sha256)
      throw new AdaptiveCloudDispatchError('invalid-dispatch', 'Outbound bytes, scope, or content reference differ from the approved manifest')
    seen.add(key)
    normalized.push({ scope: approved.scope, contentRef: approved.contentRef, bytes: new Uint8Array(part.bytes) })
  }
  normalized.sort((left, right) => `${left.scope}/${left.contentRef}`.localeCompare(`${right.scope}/${right.contentRef}`))
  return {
    parts: normalized,
    payloadFingerprint: stableFingerprint(normalized.map((part) => ({ scope: part.scope, contentRef: part.contentRef, byteLength: part.bytes.byteLength, sha256: sha256(part.bytes) })))
  }
}

/** The only public cloud transport gate: validates bytes, consumes the one-time permit, then performs network I/O. */
export async function dispatchAdaptiveCloud<T>(inputValue: unknown, authority: AdaptiveCloudDispatchAuthority, transport: AdaptiveCloudTransport<T>, limitsValue: unknown): Promise<T> {
  if (!object(inputValue) || Object.keys(inputValue).some((field) => !['permit', 'manifest', 'nodeId', 'evaluatedAt', 'parts'].includes(field)))
    throw new AdaptiveCloudDispatchError('invalid-dispatch', 'Cloud dispatch input contains unsupported fields')
  const input = inputValue as unknown as AdaptiveCloudDispatchInput
  assertAdaptiveExecutionDispatchPermit(input.permit)
  assertExecutionCloudDispatchManifest(input.manifest)
  if (
    !timestamp(input.evaluatedAt) ||
    input.evaluatedAt < input.permit.issuedAt ||
    input.evaluatedAt >= input.permit.validUntil ||
    input.evaluatedAt < input.manifest.generatedAt ||
    input.evaluatedAt >= input.manifest.validUntil
  )
    throw new AdaptiveCloudDispatchError('invalid-dispatch', 'Cloud dispatch authority is not current')
  if (
    input.permit.dispatchManifestId !== input.manifest.id ||
    input.permit.routingDecisionId !== input.manifest.routingDecisionId ||
    input.permit.proposalFingerprint !== input.manifest.proposalFingerprint ||
    !input.permit.cloudNodeIds.includes(input.nodeId) ||
    !input.manifest.cloudNodeIds.includes(input.nodeId)
  )
    throw new AdaptiveCloudDispatchError('invalid-dispatch', 'Cloud dispatch route, manifest, or node binding is invalid')
  const payload = validateParts(input.parts, input.manifest, validateLimits(limitsValue))
  if (!object(authority) || typeof authority.consumeDispatchPermit !== 'function' || !object(transport) || typeof transport.send !== 'function')
    throw new AdaptiveCloudDispatchError('invalid-dispatch', 'Cloud dispatch host authority and transport are required')
  let consumed = false
  try {
    consumed =
      authority.consumeDispatchPermit(input.permit, {
        manifestId: input.manifest.id,
        nodeId: input.nodeId,
        payloadFingerprint: payload.payloadFingerprint,
        evaluatedAt: input.evaluatedAt
      }) === true
  } catch {
    consumed = false
  }
  if (!consumed) throw new AdaptiveCloudDispatchError('permit-rejected', 'Cloud dispatch permit was rejected or already used')
  return transport.send({ nodeId: input.nodeId, parts: payload.parts })
}
