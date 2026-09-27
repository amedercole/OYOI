"""`connect_sms_phone`: the one member act that joins a phone to the SMS surface. The speaking
member names their number in chat; the tool reserves it for them and texts it, and the reply from
that phone is the proof the surface confirms."""

from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, ConfigDict, Field

from ufo.sdk.surfaces import AddressClaimState
from ufo.sdk.tools import TextContent, ToolContext, ToolDef, ToolResult
from ufo_ext_sms.surface import SURFACE_NAME
from ufo_ext_sms.twilio import channel_address, line_number, send

CONNECT_PHONE_TOOL = "connect_sms_phone"
CLAIM_TTL = timedelta(minutes=15)
PROVE_TEXT = "Reply to this message to link this phone to your agent."
CONNECT_PHONE_DESCRIPTION = (
    "Link the speaking member's mobile number so they can message the agent by SMS or WhatsApp, "
    "whichever this deploy's line is, and receive scheduled messages. Sends a message to that "
    "number; the member replies from the phone to finish. Call only with a number the member gave "
    "in this conversation."
)


class ConnectPhoneInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phone: str = Field(
        pattern=r"^\+[1-9]\d{7,14}$",
        description="The member's mobile number in E.164 form, e.g. +12065550123.",
    )


async def connect_sms_phone(ctx: ToolContext, args: ConnectPhoneInput) -> ToolResult:
    if ctx.ext is None:
        raise RuntimeError("connect_sms_phone requires the sms extension context")
    if ctx.speaker_member_id is None:
        raise ValueError("only a member can link their own phone")
    line = line_number()
    await ctx.ext.installations.bind(SURFACE_NAME, line)
    address = channel_address(line, args.phone)
    state = await ctx.ext.installations.reserve_address(
        SURFACE_NAME, address, ctx.speaker_member_id, datetime.now(UTC) + CLAIM_TTL
    )
    match state:
        case AddressClaimState.TAKEN:
            text = f"{address} is linked to another member. It was not changed."
        case AddressClaimState.LINKED:
            text = f"{address} is already linked. The member can message {line}."
        case AddressClaimState.RESERVED:
            await send(address, PROVE_TEXT)
            text = (
                f"Messaged {address} from {line}. The member replies to that message within "
                f"{int(CLAIM_TTL.total_seconds() // 60)} minutes to finish linking."
            )
    return ToolResult(content=(TextContent(text=text),))


CONNECT_PHONE = ToolDef(
    name=CONNECT_PHONE_TOOL,
    description=CONNECT_PHONE_DESCRIPTION,
    input_model=ConnectPhoneInput,
    handler=connect_sms_phone,
    side_effecting=True,
)
