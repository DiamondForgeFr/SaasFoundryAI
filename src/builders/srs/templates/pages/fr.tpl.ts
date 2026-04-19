import { FrSpec, PageBlock, PageContent } from '../../types'

export function renderFrPage(spec: FrSpec): PageContent {
  const { fr } = spec
  const blocks: PageBlock[] = []

  blocks.push({ kind: 'heading', level: 1, text: `${fr.id} — ${fr.title}` })
  if (fr.description) blocks.push({ kind: 'paragraph', text: fr.description })

  blocks.push({ kind: 'heading', level: 2, text: 'User Requirements' })
  if (!spec.urs || spec.urs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No linked user requirements.' })
  } else {
    blocks.push({ kind: 'bulleted_list', items: spec.urs.map((ur) => `${ur.id}: ${ur.narrative}`) })
  }

  blocks.push({ kind: 'heading', level: 2, text: 'Acceptance Criteria' })
  if (!fr.acceptanceCriteria || fr.acceptanceCriteria.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No acceptance criteria yet.' })
  } else {
    blocks.push({ kind: 'bulleted_list', items: fr.acceptanceCriteria })
  }

  blocks.push({ kind: 'heading', level: 2, text: 'Design (DS)' })
  if (!spec.dsItems || spec.dsItems.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No design items yet.' })
  } else {
    blocks.push({ kind: 'bulleted_list', items: spec.dsItems.map((ds) => `${ds.id}: ${ds.title}`) })
  }

  blocks.push({ kind: 'heading', level: 2, text: 'Test Cases (TC)' })
  if (!spec.tcItems || spec.tcItems.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No test cases yet.' })
  } else {
    blocks.push({ kind: 'bulleted_list', items: spec.tcItems.map((tc) => `${tc.id}: ${tc.title}`) })
  }

  const title = `${fr.id} — ${fr.title}`
  return { title, blocks }
}
