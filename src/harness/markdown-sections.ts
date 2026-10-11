import { createHash } from 'crypto'

/**
 * One top-level block of an instruction file: the preamble before the first `##` heading, or a
 * `##` section with everything up to the next `##` heading (its `###` subsections included).
 */
export interface MarkdownSection {
  /** The `##` heading text without the hashes; undefined for the preamble. */
  heading?: string
  /** The exact bytes of the block, heading line included. */
  text: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const SECTION_HEADING = /^## +(.+?)\s*#*\s*$/

/**
 * Split Markdown into its preamble and `##` sections. Lossless: joining the texts gives back the
 * input byte for byte. Fence-aware, so a `## ` line inside a code block is not a heading.
 */
export function splitSections(content: string): MarkdownSection[] {
  const lines = content.split(/(?<=\n)/)
  const sections: MarkdownSection[] = []
  let current: MarkdownSection = { text: '' }
  let fence: string | undefined

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
    }
    const heading = fence || fenceMatch ? undefined : SECTION_HEADING.exec(line.replace(/\r?\n$/, ''))
    if (heading) {
      if (current.text || current.heading !== undefined) sections.push(current)
      current = { heading: heading[1], text: line }
    } else {
      current.text += line
    }
  }
  if (current.text || current.heading !== undefined) sections.push(current)
  return sections
}

/** A section's identity independent of trailing blank lines and line endings. */
export function sectionHash(text: string): string {
  return createHash('sha256')
    .update(`${text.replace(/\r\n/g, '\n').trimEnd()}\n`)
    .digest('hex')
}
