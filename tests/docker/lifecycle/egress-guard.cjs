'use strict'

/* eslint-disable @typescript-eslint/no-require-imports -- NODE_OPTIONS preload must be CommonJS. */

const dns = require('node:dns')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')

const isLoopback = (host) => {
  if (host === undefined || host === null || host === '') return true
  const normalized = String(host).replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized === 'localhost') return true
  const family = net.isIP(normalized)
  if (family === 4) return normalized.split('.')[0] === '127'
  return family === 6 && (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1')
}

const blocked = (host) => {
  const error = new Error(`Lifecycle egress guard blocked non-loopback destination: ${String(host)}`)
  error.code = 'SF_LIFECYCLE_EGRESS_BLOCKED'
  return error
}

const hostFromConnect = (args) => {
  const first = args[0]
  if (typeof first === 'object' && first !== null) return first.path ? undefined : first.host ?? first.hostname
  if (typeof first === 'string' && !/^\d+$/.test(first)) return undefined
  return typeof args[1] === 'string' ? args[1] : undefined
}

for (const name of ['connect', 'createConnection']) {
  const original = net[name]
  net[name] = function guardedConnect(...args) {
    const host = hostFromConnect(args)
    if (!isLoopback(host)) throw blocked(host)
    return original.apply(this, args)
  }
}

const originalLookup = dns.lookup
dns.lookup = function guardedLookup(hostname, ...args) {
  if (!isLoopback(hostname)) {
    const callback = args.find((value) => typeof value === 'function')
    if (callback) return queueMicrotask(() => callback(blocked(hostname)))
    throw blocked(hostname)
  }
  return originalLookup.call(this, hostname, ...args)
}

for (const transport of [http, https]) {
  const original = transport.request
  transport.request = function guardedRequest(input, options, callback) {
    const candidate = input instanceof URL ? input.hostname : typeof input === 'string' ? new URL(input).hostname : input?.hostname ?? input?.host ?? options?.hostname ?? options?.host
    if (!isLoopback(candidate)) throw blocked(candidate)
    return original.call(this, input, options, callback)
  }
}
