import { admitLocalExecutionCandidate, assertLocalCandidateAdmission, type LocalCandidateAdmissionInput } from '../../../execution/local-candidates'

describe('local candidate admission (#755)', () => {
  it('fails closed with a stable exclusion when an attestation input is malformed', () => {
    const result = admitLocalExecutionCandidate({
      profile: {} as LocalCandidateAdmissionInput['profile'],
      proposal: {} as LocalCandidateAdmissionInput['proposal'],
      setup: {} as LocalCandidateAdmissionInput['setup'],
      benchmarkPlan: {} as LocalCandidateAdmissionInput['benchmarkPlan'],
      qualification: {} as LocalCandidateAdmissionInput['qualification'],
      currentState: {} as LocalCandidateAdmissionInput['currentState'],
      currentQualificationPolicyId: 'a'.repeat(64),
      taskClass: 'implementation',
      transport: {} as LocalCandidateAdmissionInput['transport'],
      capabilities: ['text'],
      evaluatedAt: '2026-09-14T10:00:00.000Z',
      authority: { verifyTransportAttestation: () => false }
    })

    expect(result.status).toBe('excluded')
    expect(result.status === 'excluded' && result.code).toBe('invalid-input')
    expect(() => assertLocalCandidateAdmission(result)).not.toThrow()
  })

  it('rejects an admission result that is not a candidate or stable exclusion', () => {
    expect(() => assertLocalCandidateAdmission({ status: 'admitted', evidenceRefs: [] })).toThrow()
  })
})
