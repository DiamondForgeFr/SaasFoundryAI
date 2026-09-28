import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

describe('lifecycle process egress guard', () => {
  const guard = resolve('tests/docker/lifecycle/egress-guard.cjs')

  it('blocks non-loopback TCP destinations before a connection is opened', () => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "try { require('node:net').connect({host:'example.com',port:443}); process.exit(2) } catch (error) { console.log(error.code); process.exit(error.code === 'SF_LIFECYCLE_EGRESS_BLOCKED' ? 0 : 3) }"
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--require=${guard}` } }
    )

    expect(child.status).toBe(0)
    expect(child.stdout.trim()).toBe('SF_LIFECYCLE_EGRESS_BLOCKED')
  })

  it('does not mistake a DNS hostname beginning with 127 for a loopback address', () => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "try { require('node:net').connect({host:'127.attacker.example',port:443}); process.exit(2) } catch (error) { console.log(error.code); process.exit(error.code === 'SF_LIFECYCLE_EGRESS_BLOCKED' ? 0 : 3) }"
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--require=${guard}` } }
    )

    expect(child.status).toBe(0)
    expect(child.stdout.trim()).toBe('SF_LIFECYCLE_EGRESS_BLOCKED')
  })

  it('allows loopback TCP attempts to reach the operating system', () => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "const socket=require('node:net').connect({host:'127.0.0.1',port:9}); socket.on('error', error => process.exit(error.code === 'SF_LIFECYCLE_EGRESS_BLOCKED' ? 3 : 0)); setTimeout(() => process.exit(4), 2000)"
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--require=${guard}` }, timeout: 5_000 }
    )

    expect(child.status).toBe(0)
  })
})
