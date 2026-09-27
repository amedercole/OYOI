"""A restaurant's ingredient stock: what is on hand, the par it is kept to, when to reorder, and who
supplies it. One record per workspace in the extension's scoped store, read and rewritten whole by
the three tools, which leave `parallel_safe` false so the engine runs same-round calls in order."""

import json
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field

from ufo.sdk.context import ExtensionContext
from ufo.sdk.tools import TextContent, ToolContext, ToolDef, ToolResult

INVENTORY_KEY = "inventory"
UPDATE_TOOL = "inventory_update"
REPORT_TOOL = "inventory_report"
REMOVE_TOOL = "inventory_remove"

UPDATE_DESCRIPTION = (
    "Record stock counts or change how an ingredient is tracked. Each update names one "
    "ingredient; only the fields given change. Record a count as `on_hand` in the ingredient's "
    "unit. A new ingredient needs `unit`."
)
REPORT_DESCRIPTION = (
    "Read the ingredient inventory: every item with its count, par, reorder point, supplier, and "
    "when it was last counted. Items at or below their reorder point are marked LOW with the "
    "quantity that brings them back to par."
)
REMOVE_DESCRIPTION = "Stop tracking the named ingredients."


class Item(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    unit: str
    on_hand: float | None = None
    par: float | None = None
    reorder_at: float | None = None
    supplier: str | None = None
    counted_at: datetime | None = None

    @property
    def threshold(self) -> float | None:
        return self.par if self.reorder_at is None else self.reorder_at

    @property
    def low(self) -> bool:
        threshold = self.threshold
        return self.on_hand is not None and threshold is not None and self.on_hand <= threshold

    @property
    def to_order(self) -> float | None:
        if not self.low or self.par is None or self.on_hand is None:
            return None
        return max(self.par - self.on_hand, 0.0)


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


class UpdateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    updates: tuple[ItemUpdate, ...] = Field(min_length=1)


class ReportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    low_only: bool = Field(default=False, description="Return only items at or below reorder.")


class RemoveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    names: tuple[str, ...] = Field(min_length=1)


def item_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def apply(inventory: Inventory, update: ItemUpdate, now: datetime) -> Item:
    key = item_key(update.name)
    current = inventory.items.get(key)
    if current is None and update.unit is None:
        raise ValueError(f"{update.name!r} is not tracked yet; give its unit to start tracking it")
    base = current or Item(name=" ".join(update.name.split()), unit=str(update.unit))
    changes = update.model_dump(exclude={"name"}, exclude_none=True)
    if update.on_hand is not None:
        changes["counted_at"] = now
    item = base.model_copy(update=changes)
    inventory.items[key] = item
    return item


def _number(value: float | None) -> str:
    return "?" if value is None else f"{value:g}"


def render(items: list[Item]) -> str:
    if not items:
        return "No ingredients match."
    lines = []
    for item in sorted(items, key=lambda entry: (not entry.low, entry.name.casefold())):
        line = f"{item.name}: {_number(item.on_hand)} {item.unit} (par {_number(item.par)}"
        if item.reorder_at is not None:
            line += f", reorder at {_number(item.reorder_at)}"
        line += ")"
        if item.low:
            line += f" LOW, order {_number(item.to_order)} {item.unit}"
        if item.supplier:
            line += f", supplier {item.supplier}"
        counted = f"{item.counted_at:%Y-%m-%d %H:%M} UTC" if item.counted_at else "never"
        line += f", counted {counted}"
        lines.append(line)
    return "\n".join(lines)


def _require_ext(ctx: ToolContext) -> ExtensionContext:
    if ctx.ext is None:
        raise RuntimeError("inventory tools require the restaurant_inventory extension context")
    return ctx.ext


async def _read(ext: ExtensionContext) -> Inventory:
    raw = await ext.store.get(INVENTORY_KEY)
    return Inventory() if raw is None else Inventory.model_validate(raw)


async def _write(ext: ExtensionContext, inventory: Inventory) -> None:
    await ext.store.put(INVENTORY_KEY, json.loads(inventory.model_dump_json()))


def _text(text: str) -> ToolResult:
    return ToolResult(content=(TextContent(text=text),))


async def inventory_update(ctx: ToolContext, args: UpdateInput) -> ToolResult:
    ext = _require_ext(ctx)
    inventory = await _read(ext)
    now = datetime.now(UTC)
    changed = [apply(inventory, update, now) for update in args.updates]
    await _write(ext, inventory)
    return _text(render(changed))


async def inventory_report(ctx: ToolContext, args: ReportInput) -> ToolResult:
    items = list((await _read(_require_ext(ctx))).items.values())
    if not items:
        return _text("No ingredients are tracked yet.")
    return _text(render([item for item in items if item.low] if args.low_only else items))


async def inventory_remove(ctx: ToolContext, args: RemoveInput) -> ToolResult:
    ext = _require_ext(ctx)
    inventory = await _read(ext)
    missing = [name for name in args.names if item_key(name) not in inventory.items]
    if missing:
        raise ValueError(f"not tracked: {', '.join(missing)}")
    for name in args.names:
        del inventory.items[item_key(name)]
    await _write(ext, inventory)
    return _text(f"Stopped tracking {', '.join(args.names)}.")


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
)
