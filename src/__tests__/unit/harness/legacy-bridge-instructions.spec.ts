import { createHash } from 'crypto'

import { ADOPTION_COMMON_INSTRUCTIONS, CODEX_SOURCE_CLAUDE_BRIDGE, COMMON_INSTRUCTIONS, GENERATED_INSTRUCTIONS } from '../../../harness/agent-instructions'
import { LEGACY_CAPABILITIES } from '../../../harness/legacy-bridge-instructions'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

// A generated bridge is recognised by its bytes (released-bridges.ts), and a project that holds one keeps seeing it as generated only while
// those bytes are known. The region and the projected skills were slimmed (#1101); the three bridges were not, on purpose: they carry the
// frozen text of `legacy-bridge-instructions.ts`. Changing one is a release matter (capture the bytes of the release first, see
// src/__tests__/fixtures/released-bridges/README.md), never a side effect of rewording the region.
describe('the generated bridges after the region was slimmed (#1101)', () => {
  it('keep the exact bytes of the CLI that precedes the change', () => {
    expect({
      common: sha256(COMMON_INSTRUCTIONS),
      adoption: sha256(ADOPTION_COMMON_INSTRUCTIONS),
      claudeBridge: sha256(CODEX_SOURCE_CLAUDE_BRIDGE)
    }).toEqual({
      common: 'a3042d1b141c2020a144cc83f5fd0be05cae436044d6cf72f4d00fd8d62ca0a4',
      adoption: 'f053e8ca25c58f617a81019a38f9840508faa519b641841a45f8a2fd2f366b9f',
      claudeBridge: '80ca29703ff85e31b7d83529ca2d1194723fbb29e98489ab411294816137c20a'
    })
  })

  it('carry the full capabilities text, which the generated region no longer repeats', () => {
    for (const bridge of [COMMON_INSTRUCTIONS, ADOPTION_COMMON_INSTRUCTIONS, CODEX_SOURCE_CLAUDE_BRIDGE]) expect(bridge).toContain(LEGACY_CAPABILITIES.trimEnd())
    const region = GENERATED_INSTRUCTIONS.slice(GENERATED_INSTRUCTIONS.indexOf('## Execution capabilities'))
    expect(region.length).toBeLessThan(LEGACY_CAPABILITIES.length * 0.7)
    expect(region).not.toContain('Legacy /task examples')
  })
})
