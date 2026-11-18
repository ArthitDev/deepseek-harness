#!/usr/bin/env python3
"""vault — engagement credential store for browser-fetch and scripts.

File: ~/.dsh/creds.json (mode 600). Secrets are never printed unless `get`.

Usage:
  vault add NAME [--url U] [--user U] [--pass P|--pass-stdin] [--totp S] [--note T]
  vault list            # names, urls, whether a password/TOTP exists
  vault rm NAME
  vault get NAME        # full JSON entry
"""
import argparse
import json
import os
import sys
from pathlib import Path

VAULT = Path.home() / ".dsh" / "creds.json"


def load():
    try:
        return json.loads(VAULT.read_text())
    except Exception:
        return {}


def save(data):
    VAULT.parent.mkdir(parents=True, exist_ok=True)
    VAULT.write_text(json.dumps(data, indent=2))
    os.chmod(VAULT, 0o600)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["add", "list", "rm", "get"])
    parser.add_argument("name", nargs="?")
    parser.add_argument("--url")
    parser.add_argument("--user")
    parser.add_argument("--pass", dest="password")
    parser.add_argument("--pass-stdin", action="store_true")
    parser.add_argument("--totp")
    parser.add_argument("--note")
    args = parser.parse_args()

    data = load()
    if args.command == "list":
        for name, entry in sorted(data.items()):
            flags = ("pass " if entry.get("pass") else "") + ("totp" if entry.get("totp") else "")
            print(f"{name}\t{entry.get('url', '')}\t{flags}".rstrip())
        return 0
    if args.command == "rm":
        data.pop(args.name or "", None)
        save(data)
        return 0
    if args.command == "get":
        entry = data.get(args.name or "")
        if not entry:
            print("unknown entry", file=sys.stderr)
            return 2
        print(json.dumps(entry, indent=2))
        return 0

    if not args.name:
        print("vault add requires NAME", file=sys.stderr)
        return 2
    entry = data.get(args.name, {})
    if args.url:
        entry["url"] = args.url
    if args.user:
        entry["user"] = args.user
    if args.password:
        entry["pass"] = args.password
    if args.pass_stdin:
        entry["pass"] = sys.stdin.readline().rstrip("\n")
    if args.totp:
        entry["totp"] = args.totp
    if args.note:
        entry["note"] = args.note
    data[args.name] = entry
    save(data)
    print(f"saved {args.name} (fields: {', '.join(sorted(entry))})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
