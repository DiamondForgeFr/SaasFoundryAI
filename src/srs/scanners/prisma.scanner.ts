import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CodebaseScanner, CodebaseScannerContext, EntityField, EntityFinding, EntityRelation } from './types'

const MODEL_BLOCK_RE = /model\s+(\w+)\s*\{([^}]*)\}/gs
const FIELD_LINE_RE = /^\s*(\w+)\s+([A-Za-z_][\w[\]?]*)/

function normalizeRel(path: string): string {
  return path.split('\\').join('/')
}

interface ParsedField {
  field: EntityField
  relationTarget?: string
}

export function parseFieldLine(rawLine: string): ParsedField | undefined {
  const withoutComment = rawLine.replace(/\/\/.*$/, '')
  const trimmed = withoutComment.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.startsWith('@@')) return undefined
  if (trimmed.startsWith('/') || trimmed.startsWith('*')) return undefined

  const match = withoutComment.match(FIELD_LINE_RE)
  if (!match) return undefined

  const [, name, rawType] = match
  const optional = rawType.endsWith('?')
  const isList = rawType.endsWith('[]')
  const baseType = rawType.replace(/[?[\]]+$/g, '')

  const attrs = withoutComment.slice(match[0].length)
  const isId = /@id\b/.test(attrs)
  const hasRelation = /@relation\b/.test(attrs)

  const field: EntityField = {
    name,
    type: isList ? `${baseType}[]` : baseType,
    optional,
    isId
  }
  if (!field.optional) delete field.optional
  if (!field.isId) delete field.isId

  // A line is a relation when it carries @relation, OR when its type is not
  // a scalar/enum but a model reference. We approximate the latter by "starts
  // with uppercase and is not a known scalar".
  const SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes'])
  const looksLikeModelRef = /^[A-Z]/.test(baseType) && !SCALARS.has(baseType)
  const relationTarget = hasRelation || looksLikeModelRef ? baseType : undefined

  return { field, relationTarget }
}

export function parseModel(name: string, body: string): { fields: EntityField[]; relations: EntityRelation[] } {
  const fields: EntityField[] = []
  const relations: EntityRelation[] = []
  for (const rawLine of body.split('\n')) {
    const parsed = parseFieldLine(rawLine)
    if (!parsed) continue
    fields.push(parsed.field)
    if (parsed.relationTarget) {
      relations.push({ field: parsed.field.name, target: parsed.relationTarget })
    }
  }
  void name
  return { fields, relations }
}

export function extractModels(content: string): { model: string; fields: EntityField[]; relations: EntityRelation[] }[] {
  const out: { model: string; fields: EntityField[]; relations: EntityRelation[] }[] = []
  for (const match of content.matchAll(MODEL_BLOCK_RE)) {
    const [, modelName, body] = match
    const { fields, relations } = parseModel(modelName, body)
    out.push({ model: modelName, fields, relations })
  }
  return out
}

const MODEL_AREA_OVERRIDES: Record<string, string> = {
  People: 'users',
  User: 'users',
  UserToken: 'auth',
  UserPreference: 'users',
  UserRoleLink: 'auth',
  UserAccountLink: 'accounts',
  UserEntityLink: 'organizations',
  Session: 'auth',
  Token: 'auth',
  Role: 'auth',
  RoleModuleLink: 'auth',
  RolePermissionLink: 'auth',
  Permission: 'auth',
  Module: 'auth',
  Account: 'accounts',
  AccountStatus: 'accounts',
  PeopleAccountLink: 'accounts',
  Entity: 'organizations',
  Organization: 'organizations',
  PeopleEntityLink: 'organizations',
  EntityRoleLink: 'organizations',
  Invitation: 'invitation',
  InvitationRoleLink: 'invitation',
  File: 'storage',
  Asset: 'storage',
  Media: 'storage',
  Event: 'analytics',
  AnalyticsEvent: 'analytics'
}

export function modelToArea(model: string): string {
  if (MODEL_AREA_OVERRIDES[model]) return MODEL_AREA_OVERRIDES[model]
  const lower = model[0].toLowerCase() + model.slice(1)
  return `${lower}s`.replace(/s{2,}$/, 's')
}

export const prismaScanner: CodebaseScanner = {
  id: 'prisma',
  describe: 'Prisma schema → entity findings (regex-based)',
  async collect(context: CodebaseScannerContext): Promise<EntityFinding[]> {
    const schemaFiles = context.files.filter((f) => {
      const norm = normalizeRel(f)
      return norm.endsWith('.prisma')
    })

    const findings: EntityFinding[] = []
    for (const relFile of schemaFiles) {
      const abs = join(context.scanRoot, relFile)
      let content: string
      try {
        content = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      for (const model of extractModels(content)) {
        findings.push({
          kind: 'entity',
          title: `${model.model} (${modelToArea(model.model)})`,
          area: modelToArea(model.model),
          file: normalizeRel(relFile),
          model: model.model,
          fields: model.fields,
          relations: model.relations
        })
      }
    }
    return findings
  }
}
