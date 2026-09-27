from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request
from ufo_ext_restaurant_inventory.checkup import CHECKUP_JOB, checkup_body, run_checkups
from ufo_ext_restaurant_inventory.inventory import (
    CHECKUP_NOW_TOOL,
    Inventory,
    Item,
    ItemUpdate,
    Observation,
    apply,
    due_items,
    items_needing_checkup,
    mark_checked,
    project,
    render,
    write_inventory,
)
from ufo_ext_restaurant_inventory.manifest import NAME, manifest
from ufo_ext_restaurant_inventory.routes import ROUTE_PATH, resolve_workspace

from ufo.db import workspace_tx
from ufo.harness.auth.bearer import mint_token
from ufo.runtime.access.credentials import CredentialStore
from ufo.runtime.billing.accounting import UNGATED_LEDGER
from ufo.runtime.billing.spend import NO_SPEND_GATES
from ufo.runtime.ext.context import context_for
from ufo.runtime.workspace import ws
from ufo.schema import tables
from ufo.sdk.jobs import JobFault
from ufo.serve import _mount_ext_routes

NOW = datetime(2026, 9, 27, 22, 0, tzinfo=UTC)
TODAY = NOW.date()
TOKEN_SECRET = "restaurant-inventory-token-secret"

pytestmark = [
    pytest.mark.usefixtures("database_url"),
    pytest.mark.parametrize("database_url", ["sqlite"], indirect=True),
]


def _tracked() -> Inventory:
    inventory = Inventory()
    apply(
        inventory,
        ItemUpdate(
            name="Roma  Tomatoes",
            unit="case",
            par=6,
            reorder_at=2,
            supplier="Sysco",
            daily_use=1,
            order_every_days=7,
            last_ordered=date(2026, 9, 20),
        ),
        NOW,
    )
    return inventory


def test_new_item_needs_a_unit() -> None:
    with pytest.raises(ValueError, match="give its unit"):
        apply(Inventory(), ItemUpdate(name="onions", on_hand=3), NOW)


def test_count_updates_only_given_fields_and_stamps_time() -> None:
    inventory = _tracked()
    item = apply(inventory, ItemUpdate(name="roma tomatoes", on_hand=4), NOW)
    assert (item.name, item.unit, item.on_hand, item.par, item.supplier) == (
        "Roma Tomatoes",
        "case",
        4,
        6,
        "Sysco",
    )
    assert item.counted_at == NOW
    assert not item.low_on(TODAY)


def test_at_reorder_point_is_low_and_orders_back_to_par() -> None:
    item = apply(_tracked(), ItemUpdate(name="ROMA TOMATOES", on_hand=2), NOW)
    assert item.low_on(TODAY)
    assert item.to_order_on(TODAY) == 4


def test_reorder_point_defaults_to_par() -> None:
    inventory = Inventory()
    item = apply(inventory, ItemUpdate(name="thighs", unit="lb", par=40, on_hand=40), NOW)
    assert item.low_on(TODAY)
    assert item.to_order_on(TODAY) == 0


def test_estimate_burns_down_from_last_count() -> None:
    inventory = _tracked()
    apply(inventory, ItemUpdate(name="roma tomatoes", on_hand=10, daily_use=2), NOW)
    item = inventory.items[next(iter(inventory.items))]
    later = TODAY + timedelta(days=3)
    view = project(item, later)
    assert view.estimate == 4
    assert view.days_left == 2


def test_next_checkup_is_earlier_of_projected_low_and_order_day() -> None:
    inventory = Inventory()
    apply(
        inventory,
        ItemUpdate(
            name="flour",
            unit="lb",
            on_hand=20,
            par=40,
            reorder_at=5,
            daily_use=5,
            order_every_days=14,
            last_ordered=date(2026, 9, 20),
        ),
        NOW,
    )
    item = inventory.items["flour"]
    view = project(item, TODAY)
    assert view.next_checkup == date(2026, 9, 30)
    assert view.checkup_reason is not None
    assert view.checkup_reason.value == "projected_low"
    assert not view.due


def test_snooze_pushes_checkup_to_recheck() -> None:
    inventory = _tracked()
    apply(
        inventory,
        ItemUpdate(name="roma tomatoes", observation=Observation.SOME),
        NOW,
    )
    item = inventory.items["roma tomatoes"]
    assert item.snooze_until == TODAY + timedelta(days=2)
    assert item.daily_use == 0.9
    view = project(item, TODAY)
    assert view.next_checkup == item.snooze_until
    assert view.checkup_reason is not None
    assert view.checkup_reason.value == "recheck"


def test_count_observation_blends_usage() -> None:
    inventory = Inventory()
    apply(
        inventory,
        ItemUpdate(name="oil", unit="bottle", on_hand=10, daily_use=2, par=2),
        datetime(2026, 9, 22, tzinfo=UTC),
    )
    item = apply(
        inventory,
        ItemUpdate(name="oil", on_hand=5, observation=Observation.COUNT),
        NOW,
    )
    assert item.on_hand == 5
    assert item.counted_at == NOW
    assert item.daily_use == 1.5


def test_out_observation_raises_usage_floor() -> None:
    inventory = Inventory()
    apply(
        inventory,
        ItemUpdate(name="oil", unit="bottle", on_hand=10, daily_use=1, par=2),
        datetime(2026, 9, 20, tzinfo=UTC),
    )
    item = apply(
        inventory,
        ItemUpdate(name="oil", observation=Observation.OUT),
        NOW,
    )
    assert item.on_hand == 0
    assert item.daily_use == pytest.approx(1.2)


def test_due_items_and_once_per_day_gate() -> None:
    inventory = Inventory()
    apply(
        inventory,
        ItemUpdate(
            name="mozz",
            unit="lb",
            on_hand=2,
            reorder_at=5,
            par=10,
            daily_use=1,
            order_every_days=7,
            last_ordered=date(2026, 9, 1),
        ),
        datetime(2026, 9, 20, tzinfo=UTC),
    )
    assert [item.name for item in due_items(inventory, TODAY)] == ["mozz"]
    assert [item.name for item in items_needing_checkup(inventory, TODAY, force=False)] == ["mozz"]
    mark_checked(inventory, ["mozz"], TODAY)
    assert items_needing_checkup(inventory, TODAY, force=False) == []
    assert len(items_needing_checkup(inventory, TODAY, force=True)) == 1


def test_render_lists_low_items_first() -> None:
    inventory = _tracked()
    apply(inventory, ItemUpdate(name="basil", unit="bunch", par=10, on_hand=9), NOW)
    apply(inventory, ItemUpdate(name="roma tomatoes", on_hand=1), NOW)
    apply(inventory, ItemUpdate(name="flour", unit="bag", par=4, on_hand=4, reorder_at=1), NOW)
    lines = render(list(inventory.items.values()), TODAY).splitlines()
    assert lines[0].startswith("basil: 9 bunch (par 10) LOW, order 1 bunch")
    assert lines[1].startswith("Roma Tomatoes: 1 case (par 6, reorder at 2) LOW, order 5 case")
    assert "flour" in lines[2] and "LOW" not in lines[2]


def test_checkup_body_keys_due_and_force_apart() -> None:
    fire_at = datetime(2026, 9, 27, 15, 0, tzinfo=UTC)
    _, due_key = checkup_body(["- flour"], ["flour"], fire_at, force=False)
    _, force_key = checkup_body(["- flour"], ["flour"], fire_at, force=True)
    assert due_key == "inventory_checkup:2026-09-27:flour"
    assert force_key.startswith("inventory_checkup:force:")
    assert due_key != force_key


def test_manifest_declares_checkup_job_route_and_member_read() -> None:
    declared = manifest()
    assert declared.name == NAME
    assert {tool.name for tool in declared.tools} >= {
        "inventory_update",
        "inventory_report",
        "inventory_remove",
        CHECKUP_NOW_TOOL,
    }
    assert [job.name for job in declared.jobs] == [CHECKUP_JOB]
    assert [(route.method, route.path) for route in declared.routes] == [("GET", ROUTE_PATH)]
    assert declared.member_context_read


def test_resolve_workspace_reads_the_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("UFO_TOKEN_SECRET", TOKEN_SECRET)
    workspace_id = uuid4()
    token = mint_token(TOKEN_SECRET, str(workspace_id), "owner@x.test", timedelta(hours=1))
    request = Request(
        {
            "type": "http",
            "headers": [(b"authorization", f"Bearer {token}".encode())],
        }
    )
    assert resolve_workspace(request) == workspace_id
    bare = Request({"type": "http", "headers": []})
    assert resolve_workspace(bare) is None


async def _workspace() -> UUID:
    workspace_id = uuid4()
    async with workspace_tx() as connection:
        await connection.execute(
            sa.insert(tables.workspace).values(
                id=workspace_id, created_at=sa.func.now(), updated_at=sa.func.now()
            )
        )
    return workspace_id


async def test_inventory_route_serves_the_projected_view(
    db: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("UFO_TOKEN_SECRET", TOKEN_SECRET)
    workspace_id = await _workspace()
    inventory = Inventory(
        items={
            "flour": Item(
                name="flour",
                unit="lb",
                on_hand=10,
                par=20,
                reorder_at=4,
                daily_use=2,
                counted_at=NOW,
            )
        }
    )
    with ws(workspace_id):
        await write_inventory(context_for(NAME, frozenset()), inventory)
    declared = manifest()
    app = FastAPI()
    _mount_ext_routes(
        app,
        (declared,),
        CredentialStore(fernet=Fernet(Fernet.generate_key())),
        None,
        None,
        None,
        NO_SPEND_GATES,
        UNGATED_LEDGER,
    )
    token = mint_token(TOKEN_SECRET, str(workspace_id), "owner@x.test", timedelta(hours=1))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://serve") as client:
        response = await client.get(
            f"/ext/{NAME}/{ROUTE_PATH}",
            headers={"authorization": f"Bearer {token}"},
        )
        naked = await client.get(f"/ext/{NAME}/{ROUTE_PATH}")
    assert response.status_code == 200
    body = response.json()
    assert body["checkup_requested"] is False
    assert body["items"][0]["name"] == "flour"
    assert body["items"][0]["estimate"] == 10
    assert body["items"][0]["daily_use"] == 2
    assert naked.status_code == 401


@dataclass(frozen=True)
class _EmptyReachInvoker:
    async def invoke(self, *args: object, **kwargs: object) -> None:
        raise AssertionError("invoke must not run when there is no SMS reach")

    async def redispatch(self, *args: object, **kwargs: object) -> None:
        raise AssertionError("redispatch is unused")

    async def member_reach(
        self, member_id: UUID, surfaces: tuple[str, ...], limit: int
    ) -> tuple[object, ...]:
        del member_id, surfaces, limit
        return ()


async def test_checkup_job_fails_loud_without_sms_reach(db: None) -> None:
    workspace_id = await _workspace()
    member_id = uuid4()
    async with workspace_tx() as connection:
        await connection.execute(
            sa.insert(tables.member).values(
                id=member_id,
                workspace_id=workspace_id,
                email="owner@x.test",
                is_admin=True,
                seated_at=sa.func.now(),
                created_at=sa.func.now(),
                updated_at=sa.func.now(),
            )
        )
    inventory = Inventory()
    apply(
        inventory,
        ItemUpdate(
            name="flour",
            unit="lb",
            on_hand=1,
            reorder_at=5,
            par=10,
            daily_use=1,
            last_ordered=date(2026, 9, 1),
            order_every_days=7,
        ),
        datetime(2026, 9, 20, tzinfo=UTC),
    )
    with ws(workspace_id):
        ctx = context_for(NAME, frozenset(), member_context_read=True, invoker=_EmptyReachInvoker())
        await write_inventory(ctx, inventory)
        with pytest.raises(JobFault, match="SMS conversation"):
            await run_checkups(ctx)


def test_candidates_select_workspaces_holding_inventory() -> None:
    declared = manifest()
    (job,) = declared.jobs
    assert job.candidates is not None
    assert job.schedule == "0 * * * * *"
