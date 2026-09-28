import { isAbsolute, resolve } from 'node:path'
import { isIP } from 'node:net'

import type { LifecyclePhase } from '../lifecycle/types'

export type LiveSuiteDepth = 'smoke' | 'full'

export interface LiveSuiteContract {
  schemaVersion: 1
  topology: 'monorepo' | 'multirepo'
  phase: LifecyclePhase
  depth: LiveSuiteDepth
  projectRoot: string
  webUrl: string
  apiUrl: string
  databaseUrl: string
  mailboxUrl: string
  mailboxCapability: string
  resultPath: string
  outputDir: string
  deadline: number
}

export const LIVE_SUITE_CONTRACT_ENV = 'SF_LIVE_E2E_CONTRACT'

export function parseLiveSuiteContract(raw = process.env[LIVE_SUITE_CONTRACT_ENV]): LiveSuiteContract {
  if (!raw) throw new Error(`${LIVE_SUITE_CONTRACT_ENV} is required.`)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`${LIVE_SUITE_CONTRACT_ENV} must contain one JSON object.`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Live suite contract must be an object.')
  const contract = value as Record<string, unknown>
  if (contract.schemaVersion !== 1) throw new Error('Live suite contract schemaVersion must be 1.')
  const topology = oneOf(contract.topology, ['monorepo', 'multirepo'] as const, 'topology')
  const phase = oneOf(contract.phase, ['creation', 'before-update', 'after-update'] as const, 'phase')
  const depth = oneOf(contract.depth, ['smoke', 'full'] as const, 'depth')
  const projectRoot = absolutePath(contract.projectRoot, 'projectRoot')
  const resultPath = absolutePath(contract.resultPath, 'resultPath')
  const outputDir = absolutePath(contract.outputDir, 'outputDir')
  const webUrl = loopbackUrl(contract.webUrl, ['http:'], 'webUrl')
  const apiUrl = loopbackUrl(contract.apiUrl, ['http:'], 'apiUrl')
  const databaseUrl = databaseLoopbackUrl(contract.databaseUrl)
  const mailboxUrl = loopbackUrl(contract.mailboxUrl, ['http:'], 'mailboxUrl')
  const mailboxCapability = stringValue(contract.mailboxCapability, 'mailboxCapability')
  if (mailboxCapability.length < 32) throw new Error('mailboxCapability must contain at least 32 characters.')
  if (!Number.isSafeInteger(contract.deadline) || Number(contract.deadline) <= Date.now()) throw new Error('deadline must be a future Unix timestamp in milliseconds.')
  if (resolve(resultPath) === resolve(outputDir) || !resolve(resultPath).startsWith(`${resolve(outputDir)}/`)) throw new Error('resultPath must be inside outputDir.')
  return Object.freeze({
    schemaVersion: 1,
    topology,
    phase,
    depth,
    projectRoot,
    webUrl,
    apiUrl,
    databaseUrl,
    mailboxUrl,
    mailboxCapability,
    resultPath,
    outputDir,
    deadline: Number(contract.deadline)
  })
}

function loopbackUrl(value: unknown, protocols: readonly string[], name: string): string {
  const raw = stringValue(value, name)
  const url = new URL(raw)
  if (!protocols.includes(url.protocol)) throw new Error(`${name} uses an unsupported protocol.`)
  if (url.username || url.password) throw new Error(`${name} must not contain URL credentials.`)
  if (!isLoopbackHost(url.hostname)) throw new Error(`${name} must use a loopback host.`)
  return url.toString().replace(/\/$/, '')
}

function databaseLoopbackUrl(value: unknown): string {
  const raw = stringValue(value, 'databaseUrl')
  const url = new URL(raw)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('databaseUrl uses an unsupported protocol.')
  if (!isLoopbackHost(url.hostname)) throw new Error('databaseUrl must use a loopback host.')
  return raw
}

function isLoopbackHost(value: string): boolean {
  const host = value.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost') return true
  const family = isIP(host)
  if (family === 4) return host.split('.')[0] === '127'
  return family === 6 && (host === '::1' || host === '0:0:0:0:0:0:0:1')
}

function absolutePath(value: unknown, name: string): string {
  const path = stringValue(value, name)
  if (!isAbsolute(path)) throw new Error(`${name} must be absolute.`)
  return resolve(path)
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) throw new Error(`${name} must be a non-empty string.`)
  return value
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, name: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}.`)
  return value as T[number]
}
