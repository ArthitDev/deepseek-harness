import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSessionLog, prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import {
  assertFixtureInventory,
  normalizeWebSessionVolatiles,
  omitMachineLocalContextMessages,
  recordedSessionFixturePath,
  selectedSessionFixture,
} from './scaffold.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Web seed stream timing', () => {
  it.each([2, 3])('preserves embedded timestamps from format v%i and its current projection', async (version) => {
    const fixture = await readFile(new URL(`../../../snapshots/session/skill-load/session.v${version}.jsonl`, import.meta.url), 'utf8')
    const current = prepareSessionSnapshotFixtureForComparison(fixture)
    const expected = parseSessionLog(current)

    expect(parseSeedFixture(fixture).events).toEqual(expected)
    expect(parseSeedFixture(current).events).toEqual(expected)
  })

  it.each(['session.jsonl', 'session.v1.jsonl'])('reconstructs positive stream intervals from %s', async (filename) => {
    const fixture = await readFile(new URL(`../../../snapshots/session/text-turn/${filename}`, import.meta.url), 'utf8')
    const messages = parseSeedFixture(fixture).events.filter(event => event.type === 'assistant/message')
    expect(messages).toHaveLength(1)
    const stream = messages[0]!.data.stream
    expect(stream.length).toBeGreaterThan(1)

    let previousEnd = -1
    for (const record of stream) {
      const start = 'time' in record ? record.time : record.time0
      expect(start).toBeGreaterThan(previousEnd)
      previousEnd = 'time' in record ? record.time : record.time0 + record.dt.reduce((total, delta) => total + delta, 0)
    }
    expect(previousEnd).toBeGreaterThan(0)
  })
})

describe('Web snapshot generation filenames', () => {
  it('normalizes a Windows Harness Home inside nested JSON strings', () => {
    const workspace = 'C:\\Users\\runner\\AppData\\Local\\Temp\\dsh-web-e2e-ws-test'
    const harnessHome = `${workspace}\\.dsh-home`
    const attachment = `${harnessHome}\\attachments\\poem.txt`
    const log = JSON.stringify({
      type: 'tool/call',
      data: {
        arguments: JSON.stringify({ file_path: attachment }),
        text: `<path>${attachment.replaceAll('\\', '/')}</path>`,
      },
    })

    const normalized = normalizeWebSessionVolatiles(log, `${workspace}\\workspace`, harnessHome)
    const record = JSON.parse(normalized) as { data: { arguments: string } }
    expect(JSON.parse(record.data.arguments)).toEqual({ file_path: '{{harnessHome}}/attachments/poem.txt' })
    expect(normalized).toContain('<path>{{harnessHome}}/attachments/poem.txt</path>')
    expect(normalized).not.toContain(workspace)
  })

  it('drops machine-local instruction and skill catalog injections', () => {
    const records = ['agent-instructions', 'plugin', 'skill-catalog'].map(kind => JSON.stringify({
      type: 'user/message',
      data: { source: { kind } },
    }))
    const sourced = JSON.stringify({ type: 'tool/result', sourceEventSeqs: [0, 1, 2] })
    expect(omitMachineLocalContextMessages([...records, sourced].join('\n'))).toBe([
      records[1],
      JSON.stringify({ type: 'tool/result', sourceEventSeqs: [0] }),
    ].join('\n'))
  })

  it('selects the highest parent and child generations without counting retained inputs twice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-fixture-generations-'))
    roots.push(root)
    for (const [name, version] of [
      ['session.jsonl', 0],
      ['session.v2.jsonl', 2],
      ['session.1.jsonl', 0],
      ['session.1.v1.jsonl', 1],
    ] as const) {
      await writeFile(join(root, name), `${JSON.stringify({
        type: 'session', version, id: '{{session:1}}', createdAt: 0, delegationDepth: 0,
      })}\n`)
    }

    await expect(selectedSessionFixture(join(root, 'session.jsonl')))
      .resolves.toBe(join(root, 'session.v2.jsonl'))
    await expect(selectedSessionFixture(join(root, 'session.1.jsonl')))
      .resolves.toBe(join(root, 'session.1.v1.jsonl'))
    await expect(selectedSessionFixture(join(root, 'replay.override.json')))
      .resolves.toBe(join(root, 'replay.override.json'))
  })

  it('leaves an absent override-only parent fixture unresolved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-fixture-generations-'))
    roots.push(root)

    await expect(selectedSessionFixture(join(root, 'session.jsonl'), true))
      .resolves.toBe(join(root, 'session.jsonl'))
    await expect(selectedSessionFixture(join(root, 'session.jsonl')))
      .rejects.toThrow('missing parent session fixture')
  })

  it('records beside an older generation and preserves the parent or child role', () => {
    const fixtures = join('/', 'fixtures')
    expect(recordedSessionFixturePath(join(fixtures, 'session.jsonl'), 1))
      .toBe(join(fixtures, 'session.v1.jsonl'))
    expect(recordedSessionFixturePath(join(fixtures, 'session.2.jsonl'), 3))
      .toBe(join(fixtures, 'session.2.v3.jsonl'))
    expect(recordedSessionFixturePath(join(fixtures, 'session.v1.jsonl'), 1))
      .toBe(join(fixtures, 'session.v1.jsonl'))
    expect(() => recordedSessionFixturePath(join(fixtures, 'notes.jsonl'), 1))
      .toThrow('invalid Session fixture path')
  })

  it('treats retained generations as one exact inventory role', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-fixture-inventory-'))
    roots.push(root)
    await writeFile(join(root, 'session.jsonl'), `${JSON.stringify({
      type: 'session', version: 0, id: '{{session:1}}', createdAt: 0, delegationDepth: 0,
    })}\n`)
    await writeFile(join(root, 'session.v1.jsonl'), `${JSON.stringify({
      type: 'session', version: 1, id: '{{session:1}}', createdAt: 0, delegationDepth: 0,
    })}\n`)
    await writeFile(join(root, 'ui.expected.md'), 'stable\n')

    await expect(assertFixtureInventory(root, ['session.jsonl', 'ui.expected.md']))
      .resolves.toBeUndefined()
  })
})
