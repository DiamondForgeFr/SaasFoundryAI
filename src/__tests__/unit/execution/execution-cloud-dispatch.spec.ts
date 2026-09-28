import { createHash } from 'node:crypto'

import { AdaptiveCloudDispatchError, dispatchAdaptiveCloud, type AdaptiveCloudDispatchInput } from '../../../execution/cloud-dispatch'
import { stableFingerprint } from '../../../execution/overrides'
import { createExecutionCloudDispatchManifest, type AdaptiveExecutionDispatchPermit } from '../../../execution/route-authority'

const GENERATED_AT = '2026-09-14T11:00:00.000Z'
const ISSUED_AT = '2026-09-14T12:00:00.000Z'
const EVALUATED_AT = '2026-09-14T12:01:00.000Z'
const VALID_UNTIL = '2026-09-14T13:00:00.000Z'
const bytes = new TextEncoder().encode('approved prompt')
const digest = createHash('sha256').update(bytes).digest('hex')
const limits = { maximumPartBytes: 1_024, maximumTotalBytes: 4_096 }

function fixture() {
  const manifest = createExecutionCloudDispatchManifest({
    routingDecisionId: 'a'.repeat(64),
    proposalFingerprint: 'b'.repeat(64),
    cloudNodeIds: ['fallback'],
    generatedAt: GENERATED_AT,
    validUntil: VALID_UNTIL,
    parts: [{ scope: 'prompt', contentRef: 'content/prompt', byteLength: bytes.byteLength, sha256: digest }]
  })
  const permitPayload = {
    schemaVersion: 1 as const,
    routingDecisionId: manifest.routingDecisionId,
    budgetPlanDecisionId: 'c'.repeat(64),
    proposalFingerprint: manifest.proposalFingerprint,
    dispatchManifestId: manifest.id,
    cloudNodeIds: ['fallback'],
    issuedAt: ISSUED_AT,
    validUntil: VALID_UNTIL
  }
  const permit: AdaptiveExecutionDispatchPermit = { ...permitPayload, id: stableFingerprint(permitPayload) }
  const input: AdaptiveCloudDispatchInput = {
    permit,
    manifest,
    nodeId: 'fallback',
    evaluatedAt: EVALUATED_AT,
    parts: [{ scope: 'prompt', contentRef: 'content/prompt', bytes }]
  }
  const consumed = new Set<string>()
  const authority = {
    consumeDispatchPermit: (value: AdaptiveExecutionDispatchPermit) => !consumed.has(value.id) && (consumed.add(value.id), true)
  }
  const transport = { send: jest.fn(async () => 'sent') }
  return { input, authority, transport }
}

describe('adaptive cloud dispatch gate (#757)', () => {
  it('sends approved bytes once and rejects a replay before network I/O', async () => {
    const { input, authority, transport } = fixture()
    await expect(dispatchAdaptiveCloud(input, authority, transport, limits)).resolves.toBe('sent')
    await expect(dispatchAdaptiveCloud(input, authority, transport, limits)).rejects.toMatchObject({ code: 'permit-rejected' })
    expect(transport.send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['altered bytes', (input: AdaptiveCloudDispatchInput) => ({ ...input, parts: [{ ...input.parts[0], bytes: new TextEncoder().encode('altered') }] })],
    ['undeclared scope', (input: AdaptiveCloudDispatchInput) => ({ ...input, parts: [{ ...input.parts[0], scope: 'source' as const }] })],
    ['extra part', (input: AdaptiveCloudDispatchInput) => ({ ...input, parts: [...input.parts, input.parts[0]] })],
    ['wrong cloud node', (input: AdaptiveCloudDispatchInput) => ({ ...input, nodeId: 'other-node' })],
    ['expired permit', (input: AdaptiveCloudDispatchInput) => ({ ...input, evaluatedAt: VALID_UNTIL })]
  ])('rejects %s without reaching the transport', async (_label, mutate) => {
    const { input, authority, transport } = fixture()
    await expect(dispatchAdaptiveCloud(mutate(input), authority, transport, limits)).rejects.toBeInstanceOf(AdaptiveCloudDispatchError)
    expect(transport.send).not.toHaveBeenCalled()
  })

  it('rejects configured part and aggregate byte ceilings before hashing or transport', async () => {
    const { input, authority, transport } = fixture()
    await expect(dispatchAdaptiveCloud(input, authority, transport, { maximumPartBytes: bytes.byteLength - 1, maximumTotalBytes: bytes.byteLength })).rejects.toMatchObject({
      code: 'invalid-dispatch'
    })
    expect(transport.send).not.toHaveBeenCalled()
  })
})
