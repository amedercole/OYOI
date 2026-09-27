from datetime import UTC, datetime

import pytest
from ufo_ext_restaurant_inventory.inventory import Inventory, ItemUpdate, apply, render

NOW = datetime(2026, 9, 27, 22, 0, tzinfo=UTC)


def _tracked() -> Inventory:
    inventory = Inventory()
    apply(
        inventory,
        ItemUpdate(name="Roma  Tomatoes", unit="case", par=6, reorder_at=2, supplier="Sysco"),
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
    assert not item.low


def test_at_reorder_point_is_low_and_orders_back_to_par() -> None:
    item = apply(_tracked(), ItemUpdate(name="ROMA TOMATOES", on_hand=2), NOW)
    assert item.low
    assert item.to_order == 4


def test_reorder_point_defaults_to_par() -> None:
    inventory = Inventory()
    item = apply(inventory, ItemUpdate(name="thighs", unit="lb", par=40, on_hand=40), NOW)
    assert item.low
    assert item.to_order == 0


def test_render_lists_low_items_first() -> None:
    inventory = _tracked()
    apply(inventory, ItemUpdate(name="basil", unit="bunch", par=10, on_hand=9), NOW)
    apply(inventory, ItemUpdate(name="roma tomatoes", on_hand=1), NOW)
    apply(inventory, ItemUpdate(name="flour", unit="bag", par=4, on_hand=4, reorder_at=1), NOW)
    lines = render(list(inventory.items.values())).splitlines()
    assert lines[0].startswith("basil: 9 bunch (par 10) LOW, order 1 bunch")
    assert lines[1].startswith("Roma Tomatoes: 1 case (par 6, reorder at 2) LOW, order 5 case")
    assert "flour" in lines[2] and "LOW" not in lines[2]
