import { parseArgs as parseApply } from '../../../../srs/bin/apply-srs-update'
import { SrsUsageError } from '../../../../srs/bin/args'
import { parseArgs as parseBrowse } from '../../../../srs/bin/browse-tree'
import { parseArgs as parseDraftCodebase } from '../../../../srs/bin/draft-from-codebase'
import { parseArgs as parseDraftNotion } from '../../../../srs/bin/draft-from-notion-pages'
import { parseArgs as parseEval } from '../../../../srs/bin/eval-srs'
import { parseArgs as parseVersions } from '../../../../srs/bin/list-versions'
import { parseArgs as parseNormalize } from '../../../../srs/bin/normalize'
import { parseArgs as parseSpawn } from '../../../../srs/bin/spawn'
import { parseArgs as parseValidate } from '../../../../srs/bin/validate'
import { parseArgs as parseWrite } from '../../../../srs/bin/write-srs'

/**
 * #877 — the SRS bins ignored any option they did not know: `sf srs write --spec x --dry-run`
 * dropped `--dry-run` and wrote a whole duplicate feature tree. An unknown option is now bad
 * input, refused while parsing, before anything is read or written.
 */
describe.each([
  ['write', (argv: string[]) => parseWrite(argv), ['--spec', 'spec.json']],
  ['spawn', (argv: string[]) => parseSpawn(argv), ['--epic', 'feature']],
  ['browse', (argv: string[]) => parseBrowse(argv), ['--parent', 'page']],
  ['draft --from notion-pages', (argv: string[]) => parseDraftNotion(argv), ['--ids', 'a,b']],
  ['eval', (argv: string[]) => parseEval(argv), ['--path', '.']],
  ['versions', (argv: string[]) => parseVersions(argv), ['--root-page', 'root']],
  ['normalize', (argv: string[]) => parseNormalize(argv), ['--feature', 'feature']],
  ['apply-update', (argv: string[]) => parseApply(argv), ['--patch', 'patch.json']],
  ['validate', (argv: string[]) => parseValidate(argv), ['--spec', 'spec.json']]
] as const)('sf srs %s', (_action, parse, valid) => {
  it('accepts its own options', () => {
    expect(() => parse([...valid])).not.toThrow()
  })

  it('refuses an option it does not know', () => {
    expect(() => parse([...valid, '--dry-run-please'])).toThrow(SrsUsageError)
    expect(() => parse([...valid, '--dry-run-please'])).toThrow("unknown option '--dry-run-please'")
  })
})

describe('the refusal', () => {
  it('points `write --dry-run` at the offline check', () => {
    expect(() => parseWrite(['--spec', 'spec.json', '--dry-run'])).toThrow('`sf srs validate --spec <path>`')
  })

  it('still lets draft --from codebase report an unknown option itself', () => {
    expect(parseDraftCodebase(['--path', '.', '--nope'])).toMatchObject({ unknown: '--nope' })
  })
})

describe('options that stay accepted', () => {
  it('keeps normalize --dry-run, the spelled-out default', () => {
    expect(parseNormalize(['--dry-run']).apply).toBe(false)
  })

  it("keeps eval's fixture flags", () => {
    expect(parseEval(['--fixture-inventory', 'i.json', '--fixture-findings', 'f.json', '--review-packet', 'r.json'])).toMatchObject({
      fixtureInventoryPath: 'i.json',
      fixtureFindingsPath: 'f.json',
      reviewPacketPath: 'r.json'
    })
  })

  it('keeps the positional arguments browse, draft --from codebase and validate take', () => {
    expect(parseBrowse(['page-id']).parentId).toBe('page-id')
    expect(parseDraftCodebase(['src']).scanPath).toBe('src')
    expect(parseValidate(['custom.json']).manifestPath).toBe('custom.json')
  })

  it('reports a missing value as bad input too', () => {
    expect(() => parseSpawn(['--epic'])).toThrow(SrsUsageError)
    expect(() => parseSpawn(['--version', 'v0'])).toThrow(SrsUsageError)
    expect(() => parseValidate(['--spec'])).toThrow(SrsUsageError)
  })
})
