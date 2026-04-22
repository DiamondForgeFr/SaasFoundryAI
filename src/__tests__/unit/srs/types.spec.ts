import { DsItem, EpicSpec, FrItem, NfrItem, Priority, UrItem } from '../../../builders/srs/types'

describe('SRS types (SUB-18.1 extensions)', () => {
  it('accepts priority and group on UrItem', () => {
    const ur: UrItem = {
      id: 'UR-AUTH-01-01',
      narrative: 'user can sign in',
      priority: 'P1',
      group: 'UR-AUTH-01'
    }
    expect(ur.priority).toBe('P1')
    expect(ur.group).toBe('UR-AUTH-01')
  })

  it('accepts priority, group and detail fields on FrItem', () => {
    const fr: FrItem = {
      id: 'FR-AUTH-01-01',
      title: 'Sign up endpoint',
      priority: 'P1',
      group: 'FR-AUTH-01',
      endpoint: 'POST /auth/signup',
      requestBody: '{ email, password, locale? }',
      validationRules: ['Email required', 'Password min 8 chars'],
      securityRationale: 'Prevents user enumeration',
      urRefs: ['UR-AUTH-01-01'],
      dsRefs: ['DS-AUTH-01-01']
    }
    expect(fr.priority).toBe('P1')
    expect(fr.endpoint).toBe('POST /auth/signup')
    expect(fr.validationRules).toHaveLength(2)
  })

  it('accepts group on DsItem', () => {
    const ds: DsItem = { id: 'DS-AUTH-01-01', title: 'bcrypt hash', group: 'DS-AUTH-01' }
    expect(ds.group).toBe('DS-AUTH-01')
  })

  it('constructs a NfrItem with target, priority, frRefs, group', () => {
    const nfr: NfrItem = {
      id: 'NFR-AUTH-01-01',
      title: 'Login response time',
      target: '≤ 1 second (p95)',
      priority: 'P1',
      frRefs: ['FR-AUTH-02-01'],
      group: 'NFR-AUTH-01'
    }
    expect(nfr.target).toBe('≤ 1 second (p95)')
    expect(nfr.priority).toBe('P1')
  })

  it('accepts nfrItems on EpicSpec', () => {
    const epic: EpicSpec = {
      title: 'Authentication',
      parentPageId: 'parent',
      urs: [],
      frs: [],
      nfrItems: [{ id: 'NFR-AUTH-01-01', title: 'perf', target: '≤ 1s', priority: 'P1' }]
    }
    expect(epic.nfrItems).toHaveLength(1)
  })

  it('rejects invalid Priority values at compile time (doc-test)', () => {
    const valid: Priority[] = ['P1', 'P2', 'P3']
    expect(valid).toHaveLength(3)
    // @ts-expect-error — 'P4' is not a valid Priority
    const invalid: Priority = 'P4'
    expect(invalid).toBe('P4')
  })

  it('preserves all new fields through JSON round-trip', () => {
    const epic: EpicSpec = {
      title: 'Auth',
      parentPageId: 'p',
      urs: [{ id: 'UR-1', narrative: 'n', priority: 'P1', group: 'UR-AUTH-01' }],
      frs: [
        {
          id: 'FR-1',
          title: 't',
          priority: 'P2',
          group: 'FR-AUTH-01',
          endpoint: 'GET /x',
          requestBody: '{}',
          validationRules: ['r1'],
          securityRationale: 'sr'
        }
      ],
      nfrItems: [{ id: 'NFR-1', title: 'n', target: 't', priority: 'P3' }]
    }
    const roundTripped = JSON.parse(JSON.stringify(epic)) as EpicSpec
    expect(roundTripped).toEqual(epic)
  })
})
