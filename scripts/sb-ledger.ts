#!/usr/bin/env bun
/** Engagement findings ledger + report. sqlite at ~/.dsh/ledger.sqlite.
 *
 *  ledger init
 *  ledger target add <id> <url> [--note T]
 *  ledger finding add <target-id> [--title T] [--severity s] [--evidence path] [--detail T]
 *  ledger target list / finding list [target-id]
 *  ledger report <target-id> [--out report.md]   # markdown with every finding + evidence path
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DB_PATH = process.env.LEDGER_PATH || join(homedir(), '.dsh', 'ledger.sqlite')

function open(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, note TEXT DEFAULT '', created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, target_id TEXT NOT NULL REFERENCES targets(id),
      title TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', detail TEXT DEFAULT '',
      evidence TEXT DEFAULT '', created TEXT NOT NULL
    );
  `)
  return db
}

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = argv.indexOf(`--${name}`)
  return index > -1 && argv[index + 1] ? argv[index + 1] : undefined
}
const now = (): string => new Date().toISOString()

function addTarget(id: string, url: string): void {
  const db = open()
  db.prepare('INSERT OR REPLACE INTO targets (id, url, note, created) VALUES (?, ?, ?, ?)')
    .run(id, url, flag('note') ?? '', now())
  console.log(`target added: ${id} → ${url}`)
}

function addFinding(targetId: string, title: string, severity: string, detail: string, evidence: string): void {
  const db = open()
  if (!db.prepare('SELECT id FROM targets WHERE id = ?').get(targetId)) {
    console.error(`unknown target id: ${targetId} (ledger target add first)`)
    process.exit(2)
  }
  db.prepare('INSERT INTO findings (target_id, title, severity, detail, evidence, created) VALUES (?, ?, ?, ?, ?, ?)')
    .run(targetId, title, severity, detail, evidence, now())
  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }
  console.log(`finding #${row.id} added (${severity}) → ${targetId}: ${title}`)
}

function listFindings(targetId: string | undefined): void {
  const db = open()
  const rows = targetId
    ? db.prepare('SELECT * FROM findings WHERE target_id = ? ORDER BY created DESC').all(targetId)
    : db.prepare('SELECT * FROM findings ORDER BY created DESC').all()
  for (const r of rows) {
    console.log(`#${r.id}\t${r.severity}\t${r.target_id}\t${r.title}${r.evidence ? `\t→ ${r.evidence}` : ''}`)
  }
  if (rows.length === 0) console.log('(empty)')
}

function report(targetId: string, out?: string): void {
  const db = open()
  const target = db.prepare('SELECT * FROM targets WHERE id = ?').get(targetId) as { id: string; url: string; note: string } | null
  if (!target) { console.error(`unknown target: ${targetId}`); process.exit(2) }
  const findings = db.prepare('SELECT * FROM findings WHERE target_id = ? ORDER BY severity, created DESC').all(targetId)
  const lines = [
    `# Findings — ${target.id}`, '', `Target: ${target.url}`, target.note ? `Note: ${target.note}` : '', '',
    '| # | Severity | Title | Evidence |', '|---|---|---|---|',
    ...findings.map((f: Record<string, unknown>) => `| #${f.id} | ${f.severity} | ${f.title} | ${f.evidence || '—'} |`),
    '',
  ]
  for (const f of findings) {
    lines.push(`## #${f.id} — ${f.title} (${f.severity})`)
    if (f.detail) lines.push(String(f.detail))
    if (f.evidence) lines.push(`Evidence: ${f.evidence}`)
    lines.push('')
  }
  const text = lines.join('\n')
  const path = out ?? join(DB_PATH.replace(/[^/]*$/, ''), `report-${targetId}.md`)
  mkdirSync(path.replace(/[^/]*$/, ''), { recursive: true })
  writeFileSync(path, text)
  console.log(`report written: ${path} (${findings.length} findings)`)
}

mkdirSync(DB_PATH.replace(/[^/]*$/, ''), { recursive: true })
const [command, argument] = argv
try {
  switch (command) {
    case 'target':
      if (argument && argv[2] === 'add') addTarget(argument, argv[3] ?? '')
      else console.log(JSON.stringify(open().prepare('SELECT * FROM targets ORDER BY created').all(), null, 2))
      break
    case 'finding':
      if (argument === 'add') {
        const targetId = argv[2]
        const title = flag('title')
        if (!targetId || !title) { console.error('usage: finding add <target> --title T [--severity s] [--detail T] [--evidence P]'); process.exit(2) }
        addFinding(targetId, title, flag('severity') ?? 'info', flag('detail') ?? '', flag('evidence') ?? '')
      } else if (argument === 'list') {
        listFindings(argv[3])
      } else console.error('usage: finding add <target> --title T | finding list [target]')
      break
    case 'report': report(argument ?? '', flag('out')); break
    case 'init': open(); console.log('ledger ready:', DB_PATH); break
    default: console.error('usage: ledger target add <id> <url> | finding add <target> --title T | finding list [target] | report <target> [--out F] | init')
  }
} catch (error) {
  console.error('ledger error:', String(error))
  process.exit(1)
}
