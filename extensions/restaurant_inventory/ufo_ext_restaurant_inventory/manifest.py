"""What the restaurant_inventory extension declares: the three stock tools and the skill that runs
counts, reorders, and the recurring texts that keep an owner ahead of running out."""

from pathlib import Path

from ufo.sdk.manifest import Manifest, SkillSpec
from ufo_ext_restaurant_inventory.inventory import TOOLS

NAME = "restaurant_inventory"
VERSION = "0.1.0"
SKILL_DIR = Path(__file__).parent / "skills" / "restaurant-inventory"


def manifest() -> Manifest:
    return Manifest(
        name=NAME,
        version=VERSION,
        tools=TOOLS,
        skills=(SkillSpec(path=SKILL_DIR),),
    )
