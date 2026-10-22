import { createHash } from 'crypto'

import { BridgeKind, RELEASED_BRIDGE_HASHES } from './released-bridge-hashes'

export type { BridgeKind } from './released-bridge-hashes'

/**
 * The generated instruction bridges (`AGENTS.md` pointing at `CLAUDE.md`, the adoption variant, and
 * `CLAUDE.md` pointing at `AGENTS.md`) are text the CLI renders, and the text changes with the CLI.
 * A project installed by a published release holds the bytes of that release, which the running CLI
 * no longer renders (#935). Matching only the current text classed such a bridge as the user's own
 * file: refreshed as `mixed`, or sidecar'd while it kept hiding the real instructions.
 *
 * These checks recognise the bytes of every published release (`released-bridge-hashes.ts`, generated
 * from the fixtures captured from each published package).
 */
const sha256 = (content: Buffer | string): string => createHash('sha256').update(content).digest('hex')

/** U+FEFF, spelled out: an invisible character in the source is no way to say it. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

/**
 * The text of a bridge as the release wrote it: a checkout on Windows (`core.autocrlf`) or an editor may
 * have turned its line endings into CRLF or put a byte order mark in front, which changes the bytes and not
 * the bridge. Recognition reads through both; a file with any other difference is still the user's.
 */
export function normalizeBridgeText(content: Buffer | string): string {
  const text = typeof content === 'string' ? content : content.toString('utf8')
  return (text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text).replace(/\r\n/g, '\n')
}

const releasedHashes = (kind: BridgeKind): readonly string[] => Object.values(RELEASED_BRIDGE_HASHES[kind])

/** Whether the hash is one a published release recorded for this bridge. */
export function isReleasedBridgeHash(kind: BridgeKind, hash: string | undefined): boolean {
  return hash !== undefined && releasedHashes(kind).includes(hash)
}

/** Whether these bytes are what a published release wrote for this bridge, up to line endings and a byte order mark. */
export function isReleasedBridge(kind: BridgeKind, content: Buffer | string): boolean {
  return isReleasedBridgeHash(kind, sha256(normalizeBridgeText(content)))
}

/** The releases whose bridge of this kind has these bytes (up to line endings and a byte order mark), for a message or a test. */
export function releasedBridgeVersions(kind: BridgeKind, content: Buffer | string): string[] {
  const hash = sha256(normalizeBridgeText(content))
  return Object.entries(RELEASED_BRIDGE_HASHES[kind])
    .filter(([, released]) => released === hash)
    .map(([version]) => version)
}
