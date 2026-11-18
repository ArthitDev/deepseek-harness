#!/usr/bin/env python3
"""ledger — engagement findings ledger + report (sqlite, stdlib only).

  ledger init
  ledger target add <id> <url> [--note T]
  ledger target list
  ledger finding add <target-id> --title T [--severity s] [--detail T] [--evidence P]
  ledger finding list [target-id]
  ledger report <target-id> [--out report.md]
"""
import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DB = Path.home() / ".dsh" / "ledger.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS targets (id TEXT PRIMARY KEY, url TEXT NOT NULL, note TEXT DEFAULT '', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target_id TEXT NOT NULL REFERENCES targets(id),
  title TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', detail TEXT DEFAULT '',
  evidence TEXT DEFAULT '', created TEXT NOT NULL);
"""


def open_db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB)
    db.executescript(SCHEMA)
    return db


def now():
    return datetime.now(timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["init", "target", "finding", "report"])
    parser.add_argument("args", nargs="*")
    parser.add_argument("--note", default="")
    parser.add_argument("--title")
    parser.add_argument("--severity", default="info")
    parser.add_argument("--detail", default="")
    parser.add_argument("--evidence", default="")
    parser.add_argument("--out")
    opts = parser.parse_args()
    db = open_db()

    if opts.command == "init":
        print("ledger ready:", DB)
        return 0

    if opts.command == "target":
        if opts.args and opts.args[0] == "add":
            target_id, url = opts.args[1], opts.args[2] if len(opts.args) > 2 else ""
            db.execute("INSERT OR REPLACE INTO targets (id, url, note, created) VALUES (?,?,?,?)",
                       (target_id, url, opts.note, now()))
            db.commit()
            print(f"target added: {target_id} → {url}")
        else:
            for row in db.execute("SELECT id, url, note, created FROM targets ORDER BY created"):
                print("\t".join(str(c) for c in row))
        return 0

    if opts.command == "finding":
        if opts.args and opts.args[0] == "add":
            target_id = opts.args[1]
            if not opts.title:
                print("finding add needs --title", file=sys.stderr)
                return 2
            if not db.execute("SELECT 1 FROM targets WHERE id=?", (target_id,)).fetchone():
                print(f"unknown target: {target_id} (add it first)", file=sys.stderr)
                return 2
            cur = db.execute(
                "INSERT INTO findings (target_id, title, severity, detail, evidence, created) VALUES (?,?,?,?,?,?)",
                (target_id, opts.title, opts.severity, opts.detail, opts.evidence, now()))
            db.commit()
            print(f"finding #{cur.lastrowid} added ({opts.severity}) → {target_id}: {opts.title}")
        else:
            target_id = opts.args[1] if len(opts.args) > 1 else None
            sql = "SELECT id, severity, target_id, title, evidence FROM findings"
            rows = db.execute(sql + " WHERE target_id=? ORDER BY created DESC", (target_id,)).fetchall() \
                if target_id else db.execute(sql + " ORDER BY created DESC").fetchall()
            for row in rows:
                print("\t".join(str(c) for c in row))
            if not rows:
                print("(empty)")
        return 0

    target_id = opts.args[0] if opts.args else ""
    target = db.execute("SELECT id, url, note FROM targets WHERE id=?", (target_id,)).fetchone()
    if not target:
        print(f"unknown target: {target_id}", file=sys.stderr)
        return 2
    findings = db.execute(
        "SELECT id, title, severity, detail, evidence, created FROM findings WHERE target_id=? ORDER BY severity DESC, id",
        (target_id,)).fetchall()
    lines = [f"# Findings — {target[0]}", "", f"Target: {target[1]}"]
    if target[2]:
        lines.append(f"Note: {target[2]}")
    lines += ["", "| # | Severity | Title | Evidence |", "|---|---|---|---|"]
    lines += [f"| #{f[0]} | {f[2]} | {f[1]} | {f[4] or '—'} |" for f in findings]
    lines.append("")
    for f in findings:
        lines.append(f"## #{f[0]} — {f[1]} ({f[2]})")
        if f[3]:
            lines.append(str(f[3]))
        if f[4]:
            lines.append(f"Evidence: {f[4]}")
        lines.append("")
    out = Path(opts.out) if opts.out else DB.parent / f"report-{target_id}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines))
    print(f"report written: {out} ({len(findings)} findings)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
