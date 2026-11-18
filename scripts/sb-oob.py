#!/usr/bin/env python3
"""OOB interaction collector for blind vuln classes.

Modes:
  local   — listener reachable from LAN/tailnet targets (run inside the VPN namespace)
  webhook — webhook.site token, reachable from internet targets through Mullvad egress

Usage:
  oob new [--mode local|webhook] [--note text]     mint a token + URL
  oob hits <token>                                 print collected hits (JSONL)
  oob list                                         list tokens
  oob serve [--port 18898] [--host 0.0.0.0]        run the local listener
"""
import argparse
import json
import os
import secrets
import sys
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path.home() / ".dsh" / "oob"
DEFAULT_PORT = int(os.environ.get("OOB_PUBLIC_PORT", "18898"))


def meta_path(token):
    return ROOT / f"{token}.json"


def hits_path(token):
    return ROOT / f"{token}.jsonl"


def read_meta(token):
    try:
        return json.loads(meta_path(token).read_text())
    except Exception:
        return None


def mint(mode, note):
    ROOT.mkdir(parents=True, exist_ok=True)
    token = secrets.token_hex(9)
    if mode == "webhook":
        req = urllib.request.Request("https://webhook.site/token", method="POST")
        with urllib.request.urlopen(req, timeout=20) as res:
            data = json.loads(res.read())
        meta = {"token": token, "mode": "webhook", "note": note, "url": f"https://webhook.site/{data['uuid']}",
                "uuid": data["uuid"], "createdAt": datetime.now(timezone.utc).isoformat()}
    else:
        host = os.environ.get("OOB_PUBLIC_HOST", "127.0.0.1")
        meta = {"token": token, "mode": "local", "note": note,
                "url": f"http://{host}:{DEFAULT_PORT}/{token}",
                "createdAt": datetime.now(timezone.utc).isoformat()}
    meta_path(token).write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


def print_hits(token):
    meta = read_meta(token)
    if not meta:
        print("unknown token", file=sys.stderr)
        return 2
    if meta["mode"] == "webhook":
        url = f"https://webhook.site/token/{meta['uuid']}/requests?sorting=newest"
        with urllib.request.urlopen(url, timeout=20) as res:
            data = json.loads(res.read())
        rows = data.get("data", [])
        for hit in rows:
            print(json.dumps({"at": hit.get("created_at"), "ip": hit.get("ip"), "method": hit.get("method"),
                              "url": hit.get("url"), "ua": hit.get("user_agent"),
                              "headers": hit.get("headers"), "body": hit.get("content")}))
        if not rows:
            print("(no hits)")
        return 0
    path = hits_path(token)
    print(path.read_text().rstrip("\n") if path.exists() else "(no hits)")
    return 0


def list_tokens():
    ROOT.mkdir(parents=True, exist_ok=True)
    for file in sorted(ROOT.glob("*.json")):
        meta = json.loads(file.read_text())
        hits = hits_path(meta["token"])
        count = len(hits.read_text().strip().splitlines()) if hits.exists() else 0
        print(f"{meta['token']}\t{meta['mode']}\thits={count}\t{meta['url']}\t{meta.get('note', '')}")


def serve(port, host):
    ROOT.mkdir(parents=True, exist_ok=True)

    class Handler(BaseHTTPRequestHandler):
        def _handle(self):
            token = self.path.split("/")[1].split("?")[0] if "/" in self.path else ""
            length = int(self.headers.get("content-length") or 0)
            body = self.rfile.read(min(length, 8192)).decode("utf-8", "replace") if length else ""
            if token and read_meta(token):
                entry = {"at": datetime.now(timezone.utc).isoformat(), "ip": self.client_address[0],
                         "method": self.command, "path": self.path,
                         "ua": self.headers.get("user-agent", ""),
                         "headers": dict(self.headers), "body": body[:4096]}
                with hits_path(token).open("a") as fh:
                    fh.write(json.dumps(entry) + "\n")
                print(f"[oob] hit {token} {self.command} {self.path}", flush=True)
            payload = b"ok"
            self.send_response(200)
            self.send_header("content-type", "text/plain")
            self.send_header("access-control-allow-origin", "*")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        do_GET = _handle
        do_POST = _handle
        do_PUT = _handle

        def log_message(self, *_args):
            return

    print(f"[oob] listening on {host}:{port} (root={ROOT})", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["new", "hits", "list", "serve"])
    parser.add_argument("token", nargs="?")
    parser.add_argument("--mode", default="local", choices=["local", "webhook"])
    parser.add_argument("--note", default="")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()
    if args.command == "new":
        mint(args.mode, args.note)
    elif args.command == "hits":
        return print_hits(args.token or "")
    elif args.command == "list":
        list_tokens()
    else:
        serve(args.port, args.host)
    return 0


if __name__ == "__main__":
    sys.exit(main())
