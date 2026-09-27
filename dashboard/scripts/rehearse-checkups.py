#!/usr/bin/env python3
"""Rehearse the estimated-inventory check-up demo against a running dev server."""
import json
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"


def call(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method or ("POST" if data is not None else "GET"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or b"{}")


seen = set()


def show_new_messages():
    for m in call("/api/chat")["messages"]:
        if m["id"] in seen:
            continue
        seen.add(m["id"])
        who = "TONY" if m["direction"] == "inbound" else "OYI"
        buttons = f"  [{' / '.join(m['quick_replies'])}]" if m.get("quick_replies") else ""
        ch = m.get("channel", "?")
        print(f"  {who}[{ch}]: {m['body']}{buttons}")


def inventory(names=("Mozzarella",)):
    inv = call("/api/inventory")
    for i in inv["inventory"]:
        if i["name"] in names:
            print(
                f"    · {i['name']}: ~{i['estimate']} {i['unit']}, {i['daily_use']}/day, "
                f"next {i['next_checkup']} ({i['checkup_reason']})"
            )


def advance():
    r = call("/api/demo/advance", {"days": 1})
    print(f"\n>>> Fast-forward to {r['clock']['today']}" + ("" if r["sent"] else f"  ({r['text']})"))
    show_new_messages()


def say(text):
    print(f"\n>>> Tony: {text}")
    call("/api/chat", {"body": text})
    time.sleep(0.5)
    show_new_messages()


call("/api/demo/reset", method="POST")
time.sleep(1)
inventory()

advance()                       # day 1: mozzarella projected low
say("Still have some")          # snooze + ease usage
inventory()
advance()                       # day 2: nothing (snoozed)
advance()                       # day 3: recheck
say("we've got about 4 lbs left")  # real count → recalibrate, still low → offer
inventory()
say("yes")
inventory()
advance()                       # day 4
advance()                       # day 5: tomato sauce usual order day
say("ran out of sauce yesterday actually")
inventory(("Tomato Sauce",))
say("no")
advance()                       # day 6: flour + olive oil (+ sauce still low)
say("Change")
say("skip the oil and make it 60 lbs of flour")
say("sounds good")
say("just this once")
say("we have like 12 lbs of mozz left")   # unprompted count
inventory()
