"""What the restaurant_inventory extension declares: stock tools, the check-up job that texts the
owner, the read projection a surface page reads, and the skill that runs counts, reorders, and
check-up replies."""

from pathlib import Path

from ufo.sdk.jobs import JobSpec, stored_key_workspaces
from ufo.sdk.manifest import Manifest, RouteSpec, SkillSpec
from ufo_ext_restaurant_inventory.checkup import CHECKUP_JOB, CHECKUP_SCHEDULE, run_checkups
from ufo_ext_restaurant_inventory.inventory import INVENTORY_KEY, TOOLS
from ufo_ext_restaurant_inventory.routes import ROUTE_PATH, inventory, resolve_workspace

NAME = "restaurant_inventory"
VERSION = "0.1.0"
SKILL_DIR = Path(__file__).parent / "skills" / "restaurant-inventory"


def manifest() -> Manifest:
    return Manifest(
        name=NAME,
        version=VERSION,
        tools=TOOLS,
        skills=(SkillSpec(path=SKILL_DIR),),
        jobs=(
            JobSpec(
                name=CHECKUP_JOB,
                schedule=CHECKUP_SCHEDULE,
                handler=run_checkups,
                candidates=stored_key_workspaces(NAME, INVENTORY_KEY),
                spends=True,
            ),
        ),
        routes=(
            RouteSpec(
                method="GET",
                path=ROUTE_PATH,
                handler=inventory,
                identify=resolve_workspace,
            ),
        ),
        member_context_read=True,
    )
