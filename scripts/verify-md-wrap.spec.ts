/** Markdown prose checks retain only exact, owner-scoped raw prompt blocks. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { hardWrappedProse } from './verify-md-wrap.ts'

const owner = 'snapshots/web/creator-persona/system-prompt.expected.md'
const prompt = readFileSync(new URL(`../${owner}`, import.meta.url), 'utf8')
const blocks = prompt.split(/\r?\n\r?\n/).filter(block =>
  block.startsWith('════════') || block.startsWith('RECON WORKFLOW') || block.startsWith('Workflow (strict order):'))

it('retains exactly three literal runtime blocks at their owning prompt pins', () => {
  expect(blocks).toHaveLength(3)
  for (const file of [owner, owner.replace('.expected.', '.windows.expected.'), owner.replace('creator-persona', 'optional-string-editor-windows')]) {
    expect(hardWrappedProse(file, blocks.join('\n\n'))).toEqual([])
    expect(hardWrappedProse(file.replaceAll('/', '\\'), blocks.join('\r\n\r\n').replaceAll(/(?<!\r)\n/g, '\r\n'))).toEqual([])
  }
})

it('rejects the same blocks in maintained docs or another prompt owner', () => {
  for (const file of ['docs/testing.md', owner.replace('creator-persona', 'other-owner')]) {
    expect(hardWrappedProse(file, blocks.join('\n\n'))).toHaveLength(3)
  }
})

it('rejects changed literal blocks and new wrapped prose beside them', () => {
  for (const block of blocks) {
    expect(hardWrappedProse(owner, `${block}\nUnexpected continuation`)).toHaveLength(1)
  }
  expect(hardWrappedProse(owner, `${blocks.join('\n\n')}\n\nNew prose\nwith a hard wrap`)).toEqual([
    expect.objectContaining({ text: 'New prose' }),
  ])
})
