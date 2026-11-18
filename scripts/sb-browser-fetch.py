#!/usr/bin/env python3
"""browser-fetch — one page load with a stealth-first engine ladder.

Engines, tried in order: CloakBrowser (stealth primary) -> Playwright chromium
(agent-friendly fallback) -> plain HTTP (curl, no JS). Every step is reported so
a caller can tell which engine actually served the page.

Usage:
  browser-fetch --url URL [--engine auto|cloak|playwright|curl]
                [--wait-ms 2500] [--out page.html] [--cookies-out cookies.json]
                [--vault NAME [--user-selector CSS --pass-selector CSS --submit-selector CSS]]
                [--header 'K: V'] [--proxy URL]

Vault: ~/.dsh/creds.json entries { name: {url, user, pass, totp, note} }.
Prints one JSON summary line; HTML/cookies go to the files when requested.
"""
import argparse
import json
import os
import sys
from pathlib import Path

VAULT = Path.home() / ".dsh" / "creds.json"


def vault_entry(name):
    try:
        data = json.loads(VAULT.read_text())
    except Exception:
        return None
    return data.get(name)


def log_event(step, detail):
    print(f"[browser-fetch] {step}: {detail}", file=sys.stderr)


def try_cloak(url, opts):
    try:
        from cloakbrowser import launch  # type: ignore
    except Exception as exc:
        log_event("cloak", f"unavailable ({exc.__class__.__name__})")
        return None
    try:
        browser = launch(headless=True, humanize=True)
    except Exception as exc:
        log_event("cloak", f"launch failed ({exc})")
        return None
    page = browser.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(opts.wait_ms)
        html = page.content()
        cookies = page.context.cookies()
        return {"engine": "cloakbrowser", "html": html, "cookies": cookies, "final_url": page.url,
                "status": 200, "title": page.title()}
    except Exception as exc:
        log_event("cloak", f"navigate failed ({exc})")
        return None
    finally:
        try:
            browser.close()
        except Exception:
            pass


def try_playwright(url, opts, credentials):
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception as exc:
        log_event("playwright", f"unavailable ({exc.__class__.__name__})")
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            context = browser.new_context(
                user_agent=opts.ua or ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                                       "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"),
            )
            # Light stealth: hide the obvious automation flags.
            context.add_init_script(
                "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
                "Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});"
            )
            page = context.new_page()
            for header in opts.header:
                key, _, value = header.partition(":")
                page.set_extra_http_headers({key.strip(): value.strip()})
                break
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            if credentials:
                login(page, credentials, opts)
            page.wait_for_timeout(opts.wait_ms)
            html = page.content()
            cookies = context.cookies()
            result = {"engine": "playwright", "html": html, "cookies": cookies, "final_url": page.url,
                      "status": 200, "title": page.title()}
            browser.close()
            return result
    except Exception as exc:
        log_event("playwright", f"failed ({exc})")
        return None


def login(page, credentials, opts):
    user_selector = opts.user_selector or "input[type=email], input[name*=user], input[name*=login], #username"
    pass_selector = opts.pass_selector or "input[type=password], #password"
    submit_selector = opts.submit_selector or "button[type=submit], input[type=submit]"
    try:
        if credentials.get("user"):
            page.fill(user_selector, credentials["user"], timeout=8000)
        if credentials.get("pass"):
            page.fill(pass_selector, credentials["pass"], timeout=8000)
        page.click(submit_selector, timeout=8000)
        page.wait_for_load_state("domcontentloaded", timeout=20000)
        log_event("login", f"submitted for {credentials.get('name', 'vault')}")
    except Exception as exc:
        log_event("login", f"skipped ({exc})")


def try_curl(url, opts):
    import subprocess
    cmd = ["curl", "-sk", "--compressed", "--max-time", "40", "-o", "/tmp/browser-fetch.body",
           "-w", "%{http_code} %{url_effective}", url]
    for header in opts.header:
        cmd[1:1] = ["-H", header]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout.split()
        status = int(out[0]) if out else 0
        html = Path("/tmp/browser-fetch.body").read_text(errors="replace")
        return {"engine": "curl", "html": html, "cookies": [], "final_url": out[1] if len(out) > 1 else url,
                "status": status, "title": ""}
    except Exception as exc:
        log_event("curl", f"failed ({exc})")
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--engine", default="auto", choices=["auto", "cloak", "playwright", "curl"])
    parser.add_argument("--wait-ms", type=int, default=2500)
    parser.add_argument("--out")
    parser.add_argument("--cookies-out")
    parser.add_argument("--vault")
    parser.add_argument("--user-selector")
    parser.add_argument("--pass-selector")
    parser.add_argument("--submit-selector")
    parser.add_argument("--ua")
    parser.add_argument("--header", action="append", default=[])
    opts = parser.parse_args()

    credentials = vault_entry(opts.vault) if opts.vault else None
    if opts.vault and not credentials:
        log_event("vault", f"no entry named {opts.vault}")
    chain = {
        "auto": [lambda: try_cloak(opts.url, opts),
                 lambda: try_playwright(opts.url, opts, credentials),
                 lambda: try_curl(opts.url, opts)],
        "cloak": [lambda: try_cloak(opts.url, opts)],
        "playwright": [lambda: try_playwright(opts.url, opts, credentials)],
        "curl": [lambda: try_curl(opts.url, opts)],
    }[opts.engine]

    result = None
    for attempt in chain:
        result = attempt()
        if result and result.get("html"):
            break
    if not result:
        print(json.dumps({"ok": False, "error": "all engines failed"}))
        return 1

    if opts.out:
        Path(opts.out).write_text(result["html"])
    if opts.cookies_out:
        Path(opts.cookies_out).write_text(json.dumps(result["cookies"], indent=2))
    summary = {
        "ok": True, "engine": result["engine"], "status": result.get("status"),
        "final_url": result.get("final_url"), "title": result.get("title", ""),
        "bytes": len(result["html"]), "cookies": len(result["cookies"]),
        "html_path": opts.out, "cookies_path": opts.cookies_out,
    }
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
