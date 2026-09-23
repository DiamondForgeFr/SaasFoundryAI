import { StreamingRedactor, redactText, stripAnsi } from '../../../../tests/docker/lifecycle/redaction'

describe('lifecycle diagnostic redaction', () => {
  it('redacts exact secrets split across chunks before retaining either chunk', () => {
    const secret = 'fixture-secret-across-chunks'
    const capture = new StreamingRedactor({ secrets: [secret], maxRetainedBytes: 1024 })

    expect(capture.push('prefix fixture-secret-')).toBe('')
    expect(capture.push('across-chunks suffix\n')).toBe('prefix <redacted> suffix\n')

    const result = capture.snapshot()
    expect(result.text).toBe('prefix <redacted> suffix\n')
    expect(result.text).not.toContain(secret)
  })

  it('keeps UTF-8 decoding and structured redaction intact across byte boundaries', () => {
    const capture = new StreamingRedactor({ maxRetainedBytes: 4096 })
    const bytes = Buffer.from('é Authorization: Bearer top-secret\nCookie: session=abc\nurl=postgresql://user:pass@127.0.0.1/db\n')

    capture.push(bytes.subarray(0, 1))
    capture.push(bytes.subarray(1, 27))
    capture.push(bytes.subarray(27))
    capture.end()

    expect(capture.snapshot().text).toBe('é Authorization: <redacted>\nCookie: <redacted>\nurl=postgresql://user:<redacted>@127.0.0.1/db\n')
  })

  it('redacts JWTs, JSON values, query credentials, and environment assignments', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.abcdefghijklmnop'
    const result = redactText(`{"password":"open-sesame"} GET /?token=url-secret\nAPI_KEY=key-secret\n${jwt}`)

    expect(result).toContain('"password":"<redacted>"')
    expect(result).toContain('?token=<redacted>')
    expect(result).toContain('API_KEY=<redacted>')
    expect(result).toContain('<redacted-jwt>')
    expect(result).not.toContain('open-sesame')
    expect(result).not.toContain('url-secret')
    expect(result).not.toContain('key-secret')
    expect(result).not.toContain(jwt)
  })

  it('redacts product-specific camel-case token keys from retained browser evidence', () => {
    const result = redactText('{"invitationToken":"invite-secret","resetPasswordToken":"reset-secret"}\nhttps://example.test/?invitationToken=url-secret')

    expect(result).not.toContain('invite-secret')
    expect(result).not.toContain('reset-secret')
    expect(result).not.toContain('url-secret')
    expect(result).toContain('"invitationToken":"<redacted>"')
  })

  it('replaces an unterminated oversized record rather than leaking or retaining it', () => {
    const secret = 'secret-at-the-end'
    const capture = new StreamingRedactor({ secrets: [secret], maxPendingBytes: 32, maxRetainedBytes: 128 })

    capture.push(`${'x'.repeat(40)}secret-at-`)
    capture.push('the-end is still the same oversized record')
    capture.push('\nuseful next record\n')
    capture.end()

    expect(capture.snapshot()).toMatchObject({
      text: '<redacted oversized unterminated diagnostic record>\nuseful next record\n',
      truncated: true,
      oversizedRecords: 1
    })
    expect(capture.snapshot().text).not.toContain(secret)
  })

  it('bounds retained bytes and strips ANSI only when requested for classification', () => {
    const capture = new StreamingRedactor({ maxRetainedBytes: 8 })
    capture.push('\u001b[31mFATAL\u001b[0m detail\n')
    capture.end()

    expect(capture.snapshot().retainedBytes).toBe(8)
    expect(capture.snapshot().truncated).toBe(true)
    expect(stripAnsi('\u001b[31mFATAL\u001b[0m')).toBe('FATAL')
  })
})
