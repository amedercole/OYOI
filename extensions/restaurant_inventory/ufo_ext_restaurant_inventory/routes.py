"""Read projection: the projected inventory a surface page reads with the owner's bearer."""

from uuid import UUID

from ufo.sdk.bearer import workspace_claim
from ufo.sdk.context import ExtensionContext
from ufo.sdk.http import JSONResponse, Request, Response
from ufo_ext_restaurant_inventory.inventory import inventory_view

ROUTE_PATH = "inventory"


async def inventory(ctx: ExtensionContext, request: Request) -> Response:
    del request
    return JSONResponse((await inventory_view(ctx)).model_dump(mode="json"))


def resolve_workspace(request: Request) -> UUID | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return workspace_claim(token.strip())
