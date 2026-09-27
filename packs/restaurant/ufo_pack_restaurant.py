"""The restaurant pack: an owner's kitchen assistant reached by text. SMS on the deploy's Twilio
line, ingredient inventory, recurring tasks that text the owner, durable memory, and the terminal
surface an operator founds the workspace from."""

from ufo.sdk.manifest import Pack

NAME = "restaurant"
VERSION = "0.1.0"
EXTENSIONS = (
    "sms",
    "restaurant_inventory",
    "browser_use",
    "scheduled_tasks",
    "todos",
    "memory",
    "sources",
    "context_compact",
    "index_default",
    "embed_openai",
    "flags_open",
    "ufo",
)


def pack() -> Pack:
    return Pack(name=NAME, version=VERSION, extensions=EXTENSIONS)
