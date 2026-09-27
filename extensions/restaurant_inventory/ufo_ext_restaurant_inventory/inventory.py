"""A restaurant's ingredient stock: counts, usage estimates, order cadence, and projected check-ups.

One record per workspace in the extension's scoped store, read and rewritten whole by the tools,
which leave `parallel_safe` false so the engine runs same-round calls in order. Nobody weighs the
cheese, so on-hand amounts are projections from the last count and an estimated daily usage. The
next check-up is the earlier of "projected to hit the low point" and "usual order day", pushed
back by any snooze from a "still have some" observation."""

from __future__ import annotations

import json
import math
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from ufo.sdk.context import ExtensionContext
from ufo.sdk.tools import TextContent, ToolContext, ToolDef, ToolResult

INVENTORY_KEY = "inventory"
CHECKUP_REQUESTED_KEY = "checkup_requested"
UPDATE_TOOL = "inventory_update"
REPORT_TOOL = "inventory_report"
REMOVE_TOOL = "inventory_remove"
CHECKUP_NOW_TOOL = "inventory_checkup_now"
RECHECK_AFTER_DAYS = 2

UPDATE_DESCRIPTION = (
    "Record stock counts, change how an ingredient is tracked, or fold the owner's stock "
    "observation into the usage estimate. Each update names one ingredient; only the fields "
    "given change. Record a count as `on_hand` in the ingredient's unit and set `observation` "
    "to `count`, `some`, or `out`. A new ingredient needs `unit`."
)
REPORT_DESCRIPTION = (
    "Read the ingredient inventory: every item with its projected estimate, par, reorder "
    "point, supplier, usage, next check-up, and when it was last counted. Items at or below "
    "their reorder point are marked LOW with the quantity that brings them back to par."
)
REMOVE_DESCRIPTION = "Stop tracking the named ingredients."
CHECKUP_NOW_DESCRIPTION = (
    "Queue an inventory check-up text to the owner on WhatsApp/SMS for every tracked item "
    "that is due, or every item when none are due. The background job sends it within a "
    "minute. Use when the owner says to send the check-up now."
)


class Observation(StrEnum):
    COUNT = "count"
    SOME = "some"
    OUT = "out"


class CheckupReason(StrEnum):
    PROJECTED_LOW = "projected_low"
    ORDER_DAY = "order_day"
    RECHECK = "recheck"


class Item(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    unit: str
    on_hand: float | None = None
    par: float | None = None
    reorder_at: float | None = None
    supplier: str | None = None
    counted_at: datetime | None = None
    daily_use: float | None = None
    order_every_days: int | None = None
    last_ordered: date | None = None
    snooze_until: date | None = None
    last_checkup: date | None = None

    @property
    def threshold(self) -> float | None:
        return self.par if self.reorder_at is None else self.reorder_at

    def estimate_on(self, today: date) -> float | None:
        if self.on_hand is None:
            return None
        if self.daily_use is None or self.daily_use <= 0 or self.counted_at is None:
            return max(0.0, self.on_hand)
        elapsed = max(0, (today - self.counted_at.astimezone(UTC).date()).days)
        return max(0.0, self.on_hand - self.daily_use * elapsed)

    def days_left_on(self, today: date) -> float | None:
        estimate = self.estimate_on(today)
        if estimate is None or self.daily_use is None or self.daily_use <= 0:
            return None
        return estimate / self.daily_use

    def next_checkup_on(self, today: date) -> tuple[date, CheckupReason] | None:
        candidates: list[tuple[date, CheckupReason]] = []
        if (
            self.daily_use is not None
            and self.daily_use > 0
            and self.on_hand is not None
            and self.threshold is not None
            and self.counted_at is not None
        ):
            counted = self.counted_at.astimezone(UTC).date()
            days_to_low = max(0, math.ceil((self.on_hand - self.threshold) / self.daily_use - 1e-9))
            candidates.append((counted + timedelta(days=days_to_low), CheckupReason.PROJECTED_LOW))
        if self.order_every_days is not None and self.order_every_days > 0 and self.last_ordered:
            candidates.append(
                (
                    self.last_ordered + timedelta(days=self.order_every_days),
                    CheckupReason.ORDER_DAY,
                )
            )
        if not candidates:
            return None
        candidates.sort(key=lambda entry: entry[0])
        next_date, reason = candidates[0]
        if self.snooze_until is not None and self.snooze_until > next_date:
            return self.snooze_until, CheckupReason.RECHECK
        return next_date, reason

    def due_on(self, today: date) -> bool:
        next_checkup = self.next_checkup_on(today)
        return next_checkup is not None and next_checkup[0] <= today

    def low_on(self, today: date) -> bool:
        estimate = self.estimate_on(today)
        threshold = self.threshold
        return estimate is not None and threshold is not None and estimate <= threshold

    def to_order_on(self, today: date) -> float | None:
        if not self.low_on(today) or self.par is None:
            return None
        estimate = self.estimate_on(today)
        if estimate is None:
            return None
        return max(self.par - estimate, 0.0)

    @property
    def low(self) -> bool:
        return self.low_on(datetime.now(UTC).date())

    @property
    def to_order(self) -> float | None:
        return self.to_order_on(datetime.now(UTC).date())


class Inventory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: dict[str, Item] = Field(default_factory=dict)


class ItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, description="The ingredient, e.g. 'roma tomatoes'.")
    on_hand: float | None = Field(default=None, ge=0, description="Counted quantity, in `unit`.")
    unit: str | None = Field(default=None, description="Counting unit, e.g. 'case', 'lb', 'each'.")
    par: float | None = Field(default=None, ge=0, description="Quantity to stock up to.")
    reorder_at: float | None = Field(
        default=None, ge=0, description="Reorder when on hand falls to this; defaults to par."
    )
    supplier: str | None = Field(default=None, description="Who supplies it.")
    daily_use: float | None = Field(default=None, ge=0, description="Estimated units used per day.")
    order_every_days: int | None = Field(
        default=None, ge=1, description="Usual days between orders for this ingredient."
    )
    last_ordered: date | None = Field(
        default=None, description="Date of the most recent order, YYYY-MM-DD."
    )
    observation: Observation | None = Field(
        default=None,
        description=(
            "How the owner reported stock: `count` with `on_hand`, `some` (still have some), "
            "or `out`. Required when folding a stock reply into the usage estimate."
        ),
    )


class UpdateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    updates: tuple[ItemUpdate, ...] = Field(min_length=1)


class ReportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    low_only: bool = Field(default=False, description="Return only items at or below reorder.")


class RemoveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    names: tuple[str, ...] = Field(min_length=1)


class CheckupNowInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ItemView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    unit: str
    on_hand: float | None
    estimate: float | None
    par: float | None
    reorder_at: float | None
    supplier: str | None
    counted_at: datetime | None
    daily_use: float | None
    order_every_days: int | None
    last_ordered: date | None
    days_left: float | None
    next_checkup: date | None
    checkup_reason: CheckupReason | None
    due: bool
    low: bool
    to_order: float | None
    last_checkup: date | None


class InventoryView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: tuple[ItemView, ...]
    checkup_requested: bool


def item_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def _round1(value: float) -> float:
    return math.floor(value * 10 + 0.5) / 10


def _learn(
    item: Item, observation: Observation, on_hand: float | None, today: date
) -> dict[str, object]:
    old_use = item.daily_use
    changes: dict[str, object] = {"snooze_until": None}
    if observation is Observation.SOME:
        base = 1.0 if old_use is None or old_use <= 0 else old_use
        changes["daily_use"] = max(0.1, _round1(base * 0.85))
        changes["snooze_until"] = today + timedelta(days=RECHECK_AFTER_DAYS)
        return changes
    amount = 0.0 if observation is Observation.OUT else (0.0 if on_hand is None else on_hand)
    changes["on_hand"] = amount
    if old_use is not None and item.counted_at is not None and item.on_hand is not None:
        elapsed = max(0, (today - item.counted_at.astimezone(UTC).date()).days)
        if elapsed > 0:
            observed = max(0.0, (item.on_hand - amount) / elapsed)
            new_use = (old_use + observed) / 2
            if observation is Observation.OUT:
                new_use = max(new_use, old_use * 1.15)
            changes["daily_use"] = max(0.1, _round1(new_use))
    return changes


def apply(inventory: Inventory, update: ItemUpdate, now: datetime) -> Item:
    key = item_key(update.name)
    current = inventory.items.get(key)
    if current is None and update.unit is None:
        raise ValueError(f"{update.name!r} is not tracked yet; give its unit to start tracking it")
    if update.observation is Observation.SOME and update.on_hand is not None:
        raise ValueError("observation 'some' takes no on_hand; omit the count")
    if update.observation is Observation.OUT and update.on_hand not in (None, 0):
        raise ValueError("observation 'out' sets on_hand to 0; omit the count or pass 0")
    if update.observation is Observation.COUNT and update.on_hand is None:
        raise ValueError("observation 'count' needs on_hand")
    base = current or Item(name=" ".join(update.name.split()), unit=str(update.unit))
    changes = update.model_dump(exclude={"name", "observation"}, exclude_none=True)
    today = now.astimezone(UTC).date()
    if update.observation is not None:
        changes.update(_learn(base, update.observation, update.on_hand, today))
    elif update.on_hand is not None:
        changes["counted_at"] = now
    if update.observation in (Observation.COUNT, Observation.OUT):
        changes["counted_at"] = now
    item = base.model_copy(update=changes)
    inventory.items[key] = item
    return item


def project(item: Item, today: date) -> ItemView:
    next_checkup = item.next_checkup_on(today)
    return ItemView(
        name=item.name,
        unit=item.unit,
        on_hand=item.on_hand,
        estimate=item.estimate_on(today),
        par=item.par,
        reorder_at=item.reorder_at,
        supplier=item.supplier,
        counted_at=item.counted_at,
        daily_use=item.daily_use,
        order_every_days=item.order_every_days,
        last_ordered=item.last_ordered,
        days_left=item.days_left_on(today),
        next_checkup=None if next_checkup is None else next_checkup[0],
        checkup_reason=None if next_checkup is None else next_checkup[1],
        due=item.due_on(today),
        low=item.low_on(today),
        to_order=item.to_order_on(today),
        last_checkup=item.last_checkup,
    )


def _number(value: float | None) -> str:
    return "?" if value is None else f"{value:g}"


def render(items: list[Item], today: date | None = None) -> str:
    day = datetime.now(UTC).date() if today is None else today
    if not items:
        return "No ingredients match."
    views = [project(item, day) for item in items]
    views.sort(key=lambda entry: (not entry.low, entry.name.casefold()))
    lines = []
    for view in views:
        line = f"{view.name}: {_number(view.estimate)} {view.unit} (par {_number(view.par)}"
        if view.reorder_at is not None:
            line += f", reorder at {_number(view.reorder_at)}"
        line += ")"
        if view.low:
            line += f" LOW, order {_number(view.to_order)} {view.unit}"
        if view.daily_use is not None:
            line += f", ~{_number(view.daily_use)} {view.unit}/day"
        if view.next_checkup is not None:
            line += f", next check-up {view.next_checkup.isoformat()}"
            if view.due:
                line += " DUE"
        if view.supplier:
            line += f", supplier {view.supplier}"
        counted = f"{view.counted_at:%Y-%m-%d %H:%M} UTC" if view.counted_at else "never"
        line += f", counted {counted}"
        lines.append(line)
    return "\n".join(lines)


def due_items(inventory: Inventory, today: date) -> list[Item]:
    return [item for item in inventory.items.values() if item.due_on(today)]


def items_needing_checkup(inventory: Inventory, today: date, *, force: bool) -> list[Item]:
    if force:
        return list(inventory.items.values())
    return [
        item
        for item in due_items(inventory, today)
        if item.last_checkup is None or item.last_checkup < today
    ]


def mark_checked(inventory: Inventory, names: list[str], today: date) -> None:
    for name in names:
        key = item_key(name)
        item = inventory.items.get(key)
        if item is None:
            continue
        inventory.items[key] = item.model_copy(update={"last_checkup": today})


def _require_ext(ctx: ToolContext) -> ExtensionContext:
    if ctx.ext is None:
        raise RuntimeError("inventory tools require the restaurant_inventory extension context")
    return ctx.ext


async def read_inventory(ext: ExtensionContext) -> Inventory:
    raw = await ext.store.get(INVENTORY_KEY)
    return Inventory() if raw is None else Inventory.model_validate(raw)


async def write_inventory(ext: ExtensionContext, inventory: Inventory) -> None:
    await ext.store.put(INVENTORY_KEY, json.loads(inventory.model_dump_json()))


async def checkup_requested(ext: ExtensionContext) -> bool:
    return bool(await ext.store.get(CHECKUP_REQUESTED_KEY))


async def set_checkup_requested(ext: ExtensionContext, value: bool) -> None:
    if value:
        await ext.store.put(CHECKUP_REQUESTED_KEY, {"requested": True})
    else:
        await ext.store.delete(CHECKUP_REQUESTED_KEY)


def _text(text: str) -> ToolResult:
    return ToolResult(content=(TextContent(text=text),))


async def inventory_update(ctx: ToolContext, args: UpdateInput) -> ToolResult:
    ext = _require_ext(ctx)
    inventory = await read_inventory(ext)
    now = datetime.now(UTC)
    changed = [apply(inventory, update, now) for update in args.updates]
    await write_inventory(ext, inventory)
    return _text(render(changed, now.date()))


async def inventory_report(ctx: ToolContext, args: ReportInput) -> ToolResult:
    today = datetime.now(UTC).date()
    items = list((await read_inventory(_require_ext(ctx))).items.values())
    if not items:
        return _text("No ingredients are tracked yet.")
    chosen = [item for item in items if item.low_on(today)] if args.low_only else items
    return _text(render(chosen, today))


async def inventory_remove(ctx: ToolContext, args: RemoveInput) -> ToolResult:
    ext = _require_ext(ctx)
    inventory = await read_inventory(ext)
    missing = [name for name in args.names if item_key(name) not in inventory.items]
    if missing:
        raise ValueError(f"not tracked: {', '.join(missing)}")
    for name in args.names:
        del inventory.items[item_key(name)]
    await write_inventory(ext, inventory)
    return _text(f"Stopped tracking {', '.join(args.names)}.")


async def inventory_checkup_now(ctx: ToolContext, args: CheckupNowInput) -> ToolResult:
    del args
    ext = _require_ext(ctx)
    inventory = await read_inventory(ext)
    if not inventory.items:
        raise ValueError("No ingredients are tracked yet.")
    await set_checkup_requested(ext, True)
    return _text("Check-up queued. The owner will be texted within a minute.")


async def inventory_view(ext: ExtensionContext, today: date | None = None) -> InventoryView:
    day = datetime.now(UTC).date() if today is None else today
    inventory = await read_inventory(ext)
    views = tuple(
        sorted(
            (project(item, day) for item in inventory.items.values()),
            key=lambda entry: (not entry.due, not entry.low, entry.name.casefold()),
        )
    )
    return InventoryView(items=views, checkup_requested=await checkup_requested(ext))


TOOLS = (
    ToolDef(
        name=UPDATE_TOOL,
        description=UPDATE_DESCRIPTION,
        input_model=UpdateInput,
        handler=inventory_update,
        side_effecting=True,
        binds_member_authority=False,
    ),
    ToolDef(
        name=REPORT_TOOL,
        description=REPORT_DESCRIPTION,
        input_model=ReportInput,
        handler=inventory_report,
        binds_member_authority=False,
    ),
    ToolDef(
        name=REMOVE_TOOL,
        description=REMOVE_DESCRIPTION,
        input_model=RemoveInput,
        handler=inventory_remove,
        side_effecting=True,
        binds_member_authority=False,
    ),
    ToolDef(
        name=CHECKUP_NOW_TOOL,
        description=CHECKUP_NOW_DESCRIPTION,
        input_model=CheckupNowInput,
        handler=inventory_checkup_now,
        side_effecting=True,
        binds_member_authority=False,
    ),
)
