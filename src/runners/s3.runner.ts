import ora from 'ora'

import { runBestEffort, runRequired } from '../run'

export async function initAndStartS3(projectName: string, isMonorepo: boolean, spinner: ReturnType<typeof ora>) {
  spinner.text = 'Starting MinIO S3 storage...'

  // The network usually already exists — that is not a failure.
  runBestEffort('docker network create', `docker network create ${projectName}-network`)

  // Start MinIO from unified dev-services compose
  const apiPath = isMonorepo ? 'apps/api' : `apps/${projectName}-api`
  // Required: the caller announced it was starting MinIO, so a failure has to be said.
  runRequired('docker compose up (MinIO)', `docker compose -f ${apiPath}/docker-compose.dev-services.yml up -d s3-dev s3-init`)

  return true
}
