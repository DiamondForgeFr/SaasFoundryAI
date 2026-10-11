import { sectionHash, splitSections } from '../../../harness/markdown-sections'

describe('splitSections', () => {
  it('splits the preamble and each ## section, keeping ### subsections inside', () => {
    const content = '# Title\n\nIntro\n\n## One\n\nA\n\n### Sub\n\nB\n\n## Two\nC\n'
    expect(splitSections(content)).toEqual([{ text: '# Title\n\nIntro\n\n' }, { heading: 'One', text: '## One\n\nA\n\n### Sub\n\nB\n\n' }, { heading: 'Two', text: '## Two\nC\n' }])
  })

  it('is lossless', () => {
    const content = '\n\n# T\r\n## A ##\r\nx\n```md\n## not a heading\n```\n~~~\n## nor this\n~~~\n## B\nno trailing newline'
    expect(
      splitSections(content)
        .map((s) => s.text)
        .join('')
    ).toBe(content)
  })

  it('ignores headings inside fenced code blocks', () => {
    const sections = splitSections('## A\n````\n```\n## inside\n```\n````\n## B\n')
    expect(sections.map((s) => s.heading)).toEqual(['A', 'B'])
  })

  it('reads a closing-hash heading without its hashes', () => {
    expect(splitSections('## Heading ##\n')[0].heading).toBe('Heading')
  })

  it('returns a single preamble for a file without ## headings, and nothing for an empty one', () => {
    expect(splitSections('# Only\ntext\n')).toEqual([{ text: '# Only\ntext\n' }])
    expect(splitSections('')).toEqual([])
  })
})

describe('sectionHash', () => {
  it('ignores trailing blank lines and CRLF line endings', () => {
    expect(sectionHash('## A\r\nx\r\n\r\n\r\n')).toBe(sectionHash('## A\nx'))
    expect(sectionHash('## A\nx\n')).not.toBe(sectionHash('## A\ny\n'))
  })
})
