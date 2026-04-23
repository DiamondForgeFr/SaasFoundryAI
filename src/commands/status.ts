import { collectStatus } from '../status/collect'
import { evaluatePreconditions } from '../status/preconditions'
import { renderClaudeFriendly, renderHuman, renderJson } from '../status/render'

export interface StatusCommandOptions {
  json?: boolean
  claudeFriendly?: boolean
  network?: boolean
  checkGh?: boolean
}

export async function statusCommand(options: StatusCommandOptions = {}): Promise<void> {
  const report = await collectStatus(process.cwd(), {
    checkNetwork: options.network !== false,
    checkGh: options.checkGh === true
  })
  const preconditions = evaluatePreconditions(report)
  const payload = { report, preconditions }

  if (options.json) {
    process.stdout.write(renderJson(payload) + '\n')
  } else if (options.claudeFriendly) {
    process.stdout.write(renderClaudeFriendly(payload))
  } else {
    process.stdout.write(renderHuman(payload))
  }

  const hasFail = preconditions.some((p) => p.status === 'fail')
  if (hasFail && !options.claudeFriendly) {
    process.exitCode = 1
  }
}
