import { StepDefinition } from '../types'

/**
 * S3 object-storage batch, moved verbatim from `src/prompts/project.prompts.ts`.
 * The bucket default reads the accumulated `projectName` (the session merges
 * earlier answers into the prompt run, matching the historical closure).
 */
export const storageStep: StepDefinition = {
  id: 'storage',
  title: 'Object storage (S3)',
  fields: [
    {
      type: 'list',
      name: 's3Setup',
      message: 'Do you want to set up object storage (S3) for file uploads (logos, documents, etc.)?',
      choices: [
        {
          name: 'Yes, add MinIO with Docker (free, S3-compatible, added to dev services)',
          value: 'docker'
        },
        {
          name: 'Yes, connect to my existing S3-compatible server',
          value: 'credentials'
        },
        { name: "No, I'll do it later", value: 'manual' }
      ]
    },
    {
      type: 'input',
      name: 's3Credentials.endpoint',
      message: 'S3 endpoint URL (e.g. https://s3.amazonaws.com or http://minio.example.com:9000)',
      when: (s3) => s3.s3Setup === 'credentials',
      validate: (input: string) => {
        if (!input) return 'Endpoint URL is required'
        return true
      }
    },
    {
      type: 'input',
      name: 's3Credentials.accessKey',
      message: 'S3 access key',
      when: (s3) => s3.s3Setup === 'credentials',
      validate: (input: string) => {
        if (!input) return 'Access key is required'
        return true
      }
    },
    {
      type: 'input',
      name: 's3Credentials.secretKey',
      message: 'S3 secret key',
      when: (s3) => s3.s3Setup === 'credentials',
      validate: (input: string) => {
        if (!input) return 'Secret key is required'
        return true
      }
    },
    {
      type: 'input',
      name: 's3Credentials.bucket',
      message: 'S3 bucket name',
      when: (s3) => s3.s3Setup === 'credentials' || s3.s3Setup === 'docker',
      default: (current: { projectName?: string }) => `${current.projectName}-uploads`
    },
    {
      type: 'input',
      name: 's3Credentials.region',
      message: 'S3 region',
      when: (s3) => s3.s3Setup === 'credentials',
      default: 'us-east-1'
    }
  ]
}
