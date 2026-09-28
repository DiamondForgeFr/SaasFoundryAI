/**
 * Resources
 */
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as dotenv from 'dotenv'
import request from 'supertest'

/**
 * Dependencies
 */
import { ApiDocsController } from '@modules/api-docs/controllers/api-docs.controller'
import { ApiDocsService } from '@modules/api-docs/services/api-docs.service'

// Load test environment variables
dotenv.config({ path: '.env.test' })

/**
 * Declaration
 *
 * The ApiDocsService is stubbed so the test exercises the public HTTP contract of the controller
 * (200 with the document, 500 when it is not generated) without invoking the real generator, which
 * would write to apps/api/docs/openapi.json on disk.
 */
describe('Api Docs Module (e2e)', () => {
  let app: INestApplication
  const getDocument = jest.fn()

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ApiDocsController],
      providers: [{ provide: ApiDocsService, useValue: { getDocument } }]
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns 200 with the OpenAPI document when it is available', async () => {
    const doc = { openapi: '3.0.0', info: { title: 'saasfoundry', version: '1.0.0' }, paths: {} }
    getDocument.mockReturnValue(doc)

    const response = await request(app.getHttpServer()).get('/api/api/docs/openapi.json').expect(200)

    expect(response.body).toMatchObject({ openapi: '3.0.0' })
    expect(response.body.info.title).toBe('saasfoundry')
  })

  it('returns 500 when the documentation has not been generated', async () => {
    getDocument.mockImplementation(() => {
      throw new Error('OpenAPI documentation not generated. Call generateDocumentation() first.')
    })

    await request(app.getHttpServer()).get('/api/api/docs/openapi.json').expect(500)
  })
})
