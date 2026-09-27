"""The SMS surface: an addressed, durable chat surface on the deploy's Twilio line.

The sender's phone number is the address, so `surface_address` picks the workspace and member
before anything is bound — the line is the deploy's, and every workspace shares it. A number joins
through `connect_sms_phone`, which reserves it and texts it; the reply from that phone proves it and
is answered with a confirmation rather than admitted. Every later text is admitted on the
member's SMS conversation, keyed by their number, and each terminal reply — a scheduled fire's
included — is texted back by the writeback poller through `post`."""

from datetime import UTC, datetime
from uuid import UUID
from xml.sax.saxutils import escape

from ufo.sdk.audience import conversation_audience
from ufo.sdk.http import Request, Response
from ufo.sdk.surfaces import (
    NOTHING_DELIVERED,
    AskUserInput,
    NothingDelivered,
    SurfaceAuth,
    SurfaceContext,
    TurnContext,
    Writeback,
    writeback_says_nothing,
)
from ufo_ext_sms.twilio import SIGNATURE_HEADER, auth_token, public_url, send, signature_valid

SURFACE_NAME = "sms"
INBOUND_PATH = "inbound"
LINKED_REPLY = "This number is linked. Text here to reach your agent."
FAILED_REPLY = "That request did not finish. Send it again."
SOURCE_LINE = "Phone message from {sender}"
TWIML_CONTENT_TYPE = "text/xml"


def twiml(message: str | None = None) -> Response:
    body = "" if message is None else f"<Message>{escape(message)}</Message>"
    return Response(
        f'<?xml version="1.0" encoding="UTF-8"?><Response>{body}</Response>',
        media_type=TWIML_CONTENT_TYPE,
    )


async def identify(request: Request, auth: SurfaceAuth) -> UUID | None:
    """Verify Twilio signed this webhook, then bind the workspace the sender's number reaches."""
    claimed = request.headers.get(SIGNATURE_HEADER)
    if claimed is None:
        return None
    params = {name: str(value) for name, value in (await request.form()).items()}
    if not signature_valid(auth_token(), public_url(request), params, claimed):
        return None
    sender = params.get("From")
    if sender is None:
        return None
    return await auth.addressed_workspace(sender)


async def inbound(ctx: SurfaceContext, request: Request) -> Response:
    form = await request.form()
    sender = str(form["From"])
    message_sid = str(form["MessageSid"])
    claim = await ctx.address_claim(sender)
    if claim is None or claim.proved_by == message_sid:
        return twiml()
    if claim.claim_expires_at is not None:
        if claim.claim_expires_at <= datetime.now(UTC):
            return twiml()
        await ctx.confirm_address(sender, message_sid)
        return twiml(LINKED_REPLY)
    conversation_id = await ctx.conversation_for(sender, conversation_audience(claim.member_id))
    await ctx.admit(
        conversation_id,
        str(form.get("Body", "")),
        idempotency_key=message_sid,
        context=TurnContext(sender=sender, source=SOURCE_LINE.format(sender=sender)),
        speaker_member_id=claim.member_id,
    )
    return twiml()


def render_question(asked: AskUserInput) -> str:
    """A structured question as plain text: SMS has no buttons, so options are numbered and the
    member answers with the number or in their own words, which the next turn reads."""
    blocks = []
    for question in asked.questions:
        options = question.options or ()
        numbered = (f"{index}. {option.label}" for index, option in enumerate(options, start=1))
        blocks.append("\n".join((question.question, *numbered)))
    return "\n\n".join(blocks)


async def post(ctx: SurfaceContext, writeback: Writeback) -> str | NothingDelivered:
    if writeback_says_nothing(writeback):
        return NOTHING_DELIVERED
    terminal = writeback.terminal
    lines = [terminal.text.strip() if terminal.status == "done" else FAILED_REPLY]
    if terminal.question is not None:
        lines.append(render_question(terminal.question))
    lines.extend(artifact.filename for artifact in writeback.artifacts)
    return await send(writeback.queue_key, "\n\n".join(line for line in lines if line))


async def attach(ctx: SurfaceContext, writeback: Writeback, reply_ref: str) -> None:
    """SMS carries no file the agent shares: `post` names each one in the reply, so there is
    nothing left to upload. The poller delivers only through a surface declaring both phases."""
