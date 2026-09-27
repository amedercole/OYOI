#!/usr/bin/env python3
"""Drive the dashboard chat API against a running ufo serve. Prints the reply text."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as res:
        return json.loads(res.read().decode())


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read().decode())


def main() -> None:
    inventory = get("/api/inventory")
    print(f"items: {len(inventory.get('inventory') or [])}")
    reply = post(
        "/api/chat",
        {"body": "Send the inventory check-up now. Use inventory_checkup_now."},
    )
    print("checkup reply:", reply.get("reply") or reply.get("error"))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as error:
        print(f"failed: {error}", file=sys.stderr)
        sys.exit(1)
