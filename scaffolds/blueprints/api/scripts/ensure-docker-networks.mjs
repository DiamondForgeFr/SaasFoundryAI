#!/usr/bin/env node
/**
 * Creates the external Docker networks a compose file declares, when they do not exist yet.
 *
 * Usage: node scripts/ensure-docker-networks.mjs <compose-file> [<compose-file>...]
 *
 * The dev services, the API container and the web container all join the project's network, from
 * three different compose files, so none of them owns it: each declares it `external: true`, and
 * Compose refuses to start when an external network is missing. Nothing created it on a fresh
 * project or a fresh clone, and `npm run services:up` failed on the first command of the README.
 * Creating it here, before `docker compose up`, keeps it shared and outliving `services:down`.
 *
 * Plain Node and `docker` only, so the npm scripts work the same from macOS, Linux and Windows shells.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Strips a trailing `# comment` and surrounding quotes from a YAML scalar. */
function scalar(raw) {
  return raw
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
}

/**
 * Names of the networks declared `external: true` under the top-level `networks:` key.
 * An entry's `name:` wins over its key, as in Compose itself.
 */
function externalNetworks(composeText) {
  const names = []
  let inNetworks = false
  let current = null
  const flush = () => {
    if (current?.external) names.push(current.name || current.key)
    current = null
  }

  for (const line of composeText.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (/^\S/.test(line)) {
      flush()
      inNetworks = /^networks:\s*(#.*)?$/.test(line)
      continue
    }
    if (!inNetworks) continue

    const entry = line.match(/^ {2}([^\s#][^:]*):\s*(#.*)?$/)
    if (entry) {
      flush()
      current = { key: scalar(entry[1]) }
      continue
    }
    const property = line.match(/^ {4}(external|name):\s*(.+)$/)
    if (current && property) {
      if (property[1] === 'external') current.external = scalar(property[2]) === 'true'
      else current.name = scalar(property[2])
    }
  }
  flush()
  return names
}

function docker(args, stdio) {
  return spawnSync('docker', args, { stdio })
}

/** Creates `name` unless it exists. Returns false when it exists in neither case. */
function ensureNetwork(name) {
  const inspect = docker(['network', 'inspect', name], 'ignore')
  if (inspect.error) {
    console.error(`✗ Docker is not available (${inspect.error.message}). Install or start Docker, then run this again.`)
    return false
  }
  if (inspect.status === 0) return true

  const create = docker(['network', 'create', name], ['ignore', 'ignore', 'inherit'])
  if (create.status === 0) {
    console.log(`✓ Created the Docker network ${name}`)
    return true
  }
  // Another project or terminal may have created it in the meantime: that is a success too.
  return docker(['network', 'inspect', name], 'ignore').status === 0
}

function main(files) {
  if (files.length === 0) {
    console.error('Usage: node scripts/ensure-docker-networks.mjs <compose-file> [<compose-file>...]')
    return 2
  }
  const names = new Set()
  for (const file of files) {
    for (const name of externalNetworks(readFileSync(file, 'utf8'))) names.add(name)
  }
  for (const name of names) {
    if (!ensureNetwork(name)) {
      console.error(`✗ Could not create the Docker network ${name}`)
      return 1
    }
  }
  return 0
}

process.exitCode = main(process.argv.slice(2))
