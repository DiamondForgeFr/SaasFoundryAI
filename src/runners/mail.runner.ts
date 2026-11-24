import ora from 'ora'

import { MAIL_CATCHER_SERVICE } from '../builders/dev-services.builder'
import { runBestEffort, runRequired } from '../run'

/** Start the development mail catcher (Mailpit) from the project's dev-services compose (#976). */
export async function initAndStartMailCatcher(projectName: string, isMonorepo: boolean, spinner: ReturnType<typeof ora>) {
  spinner.text = 'Starting the mail catcher (Mailpit)...'

  // The network usually already exists — that is not a failure.
  runBestEffort('docker network create', `docker network create ${projectName}-network`)

  const apiPath = isMonorepo ? 'apps/api' : `apps/${projectName}-api`
  // Required: the caller announced it was starting the catcher, so a failure has to be said.
  runRequired('docker compose up (Mailpit)', `docker compose -f ${apiPath}/docker-compose.dev-services.yml up -d ${MAIL_CATCHER_SERVICE}`)

  return true
}
