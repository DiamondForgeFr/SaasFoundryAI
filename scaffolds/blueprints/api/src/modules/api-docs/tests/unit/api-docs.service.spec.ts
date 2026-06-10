/**
 * Resources
 */
import { INestApplication } from '@nestjs/common'

/**
 * Dependencies
 */
import { ApiDocsService } from '@modules/api-docs/services/api-docs.service'

/**
 * Mocks
 *
 * Stub out Swagger document generation, the zod cleanup pass and the filesystem so the unit
 * test never touches the real apps/api/docs/openapi.json (overwriting it would create codegen drift).
 */
jest.mock('@nestjs/swagger', () => ({
  DocumentBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setVersion: jest.fn().mockReturnThis(),
    setContact: jest.fn().mockReturnThis(),
    setLicense: jest.fn().mockReturnThis(),
    addBearerAuth: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({})
  })),
  SwaggerModule: { createDocument: jest.fn().mockReturnValue({ openapi: '3.0.0', info: { title: 'test' }, paths: {} }) }
}))

jest.mock('nestjs-zod', () => ({ cleanupOpenApiDoc: jest.fn((doc) => doc) }))

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}))

import { existsSync, writeFileSync } from 'fs'

/**
 * Declaration
 */
describe('ApiDocsService', () => {
  let service: ApiDocsService
  const fakeApp = {} as INestApplication

  beforeEach(() => {
    service = new ApiDocsService()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('isDocumentGenerated', () => {
    it('returns false before any document has been generated', () => {
      expect(service.isDocumentGenerated()).toBe(false)
    })
  })

  describe('getDocument', () => {
    it('throws when the document has not been generated yet', () => {
      expect(() => service.getDocument()).toThrow('OpenAPI documentation not generated. Call generateDocumentation() first.')
    })
  })

  describe('generateDocumentation', () => {
    it('builds, persists and caches the OpenAPI document', () => {
      const doc = service.generateDocumentation(fakeApp)

      expect(doc).toMatchObject({ openapi: '3.0.0' })
      // The cleaned document is written to disk exactly once (the openapi.json output).
      expect(writeFileSync).toHaveBeenCalledTimes(1)
      // existsSync returned true for both the docs dir and index.html, so no extra HTML is written.
      expect(existsSync).toHaveBeenCalled()
    })

    it('exposes the cached document afterwards', () => {
      service.generateDocumentation(fakeApp)

      expect(service.isDocumentGenerated()).toBe(true)
      expect(service.getDocument()).toMatchObject({ openapi: '3.0.0' })
    })
  })
})
