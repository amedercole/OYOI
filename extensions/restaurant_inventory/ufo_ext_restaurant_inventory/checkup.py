"""The check-up runner: once a minute, text the owner about every ingredient that is due.

It finds workspaces holding inventory, picks items due today (or every item when a check-up was
requested), reaches the owner on their SMS/WhatsApp conversation, and invokes one bundled turn.
The SMS surface writeback texts the reply. Fail loud when inventory exists but no SMS reach does —
a workspace that never connected a phone cannot be texted."""

from dataclasses import dataclass
from datetime import UTC, datetime

from ufo.sdk.context import AgentArchived, ExtensionContext, FiredBy
from ufo.sdk.jobs import JobFault
from ufo_ext_restaurant_inventory.inventory import (
    checkup_requested,
    items_needing_checkup,
    mark_checked,
    project,
    read_inventory,
    set_checkup_requested,
    write_inventory,
)

CHECKUP_JOB = "inventory_checkup"
CHECKUP_SCHEDULE = "0 * * * * *"
SMS_SURFACE = "sms"
FIRED_KIND = "inventory_checkup"
CHECKUP_INSTRUCTION = (
    "Text the owner an inventory check-up for the ingredients below. Bundle them into one "
    "message. For each, say your estimated amount and why you are checking (projected low, "
    "usual order day, or recheck). Offer choices Yes / Change / Still have some. When they "
    "reply, record each observation with inventory_update (`observation` = count with "
    "`on_hand`, some, or out) and confirm any order before placing it."
)


def checkup_body(
    lines: list[str], names: list[str], fire_at: datetime, *, force: bool
) -> tuple[str, str]:
    stamp = fire_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    inbound = (
        f"<inventory_checkup>\nscheduled_fire: {stamp}\n</inventory_checkup>\n"
        f"{CHECKUP_INSTRUCTION}\n\n" + "\n".join(lines)
    )
    day = fire_at.astimezone(UTC).date().isoformat()
    slug = ",".join(sorted(name.casefold() for name in names))
    key = f"inventory_checkup:force:{stamp}:{slug}" if force else f"inventory_checkup:{day}:{slug}"
    return inbound, key


@dataclass(frozen=True)
class CheckupRunner:
    ctx: ExtensionContext

    async def run(self) -> None:
        today = datetime.now(UTC).date()
        inventory = await read_inventory(self.ctx)
        if not inventory.items:
            return
        force = await checkup_requested(self.ctx)
        targets = items_needing_checkup(inventory, today, force=force)
        if not targets:
            if force:
                await set_checkup_requested(self.ctx, False)
            return
        owner_id = await self.ctx.earliest_seated_admin()
        if owner_id is None:
            raise JobFault("inventory check-up needs a seated admin")
        reaches = await self.ctx.member_reach(owner_id, (SMS_SURFACE,), limit=1)
        if not reaches:
            raise JobFault("inventory check-up needs an SMS conversation for the owner")
        reach = reaches[0]
        lines = []
        for item in sorted(targets, key=lambda entry: entry.name.casefold()):
            view = project(item, today)
            reason = "?" if view.checkup_reason is None else view.checkup_reason.value
            amount = "?" if view.estimate is None else f"{view.estimate:g}"
            lines.append(
                f"- {item.name}: ~{amount} {item.unit} "
                f"(low point {item.threshold!s}, uses ~{item.daily_use!s}/day, reason {reason})"
            )
        fire_at = datetime.now(UTC)
        inbound, key = checkup_body(lines, [item.name for item in targets], fire_at, force=force)
        try:
            turn_id = await self.ctx.invoke(
                reach.conversation_id,
                reach.agent_id,
                inbound,
                key,
                as_scheduled=True,
                fired_by=FiredBy(kind=FIRED_KIND, name=CHECKUP_JOB, title="Inventory check-up"),
                acting_member_id=owner_id,
            )
        except AgentArchived:
            return
        if turn_id is None:
            return
        mark_checked(inventory, [item.name for item in targets], today)
        await write_inventory(self.ctx, inventory)
        await set_checkup_requested(self.ctx, False)


async def run_checkups(ctx: ExtensionContext) -> None:
    await CheckupRunner(ctx=ctx).run()
