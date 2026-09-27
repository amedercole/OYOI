"""Twilio Programmable Messaging over async HTTP. The deploy owns one line: every workspace's texts
leave from it, and every webhook Twilio posts to it is verified against the account's auth token
before a workspace is bound."""

import base64
import hashlib
import hmac
from collections.abc import Mapping

import httpx

from ufo.sdk.credentials import deploy_env
from ufo.sdk.http import Request

ACCOUNT_SID_ENV = "TWILIO_ACCOUNT_SID"
AUTH_TOKEN_ENV = "TWILIO_AUTH_TOKEN"
LINE_NUMBER_ENV = "TWILIO_SMS_NUMBER"
API_BASE = "https://api.twilio.com/2010-04-01"
SEGMENT_MAX_CHARS = 1500
"""Twilio refuses a body over 1600 characters; the margin leaves room for a `(1/3)` marker."""
BODY_MAX_CHARS = 12_000
SEND_TIMEOUT_SECONDS = 20.0
SIGNATURE_HEADER = "x-twilio-signature"


def _present(name: str, value: str | None) -> str:
    if value is None:
        raise RuntimeError(f"{name} is required for the sms surface")
    return value


def auth_token() -> str:
    return _present(AUTH_TOKEN_ENV, deploy_env(AUTH_TOKEN_ENV))


def line_number() -> str:
    """The deploy's Twilio sender every message leaves from: an E.164 number for SMS, or
    `whatsapp:` and the number for a WhatsApp sender."""
    return _present(LINE_NUMBER_ENV, deploy_env(LINE_NUMBER_ENV))


def channel_address(line: str, phone: str) -> str:
    """A member's phone as the line's channel addresses it. Twilio names a WhatsApp party
    `whatsapp:+1…` in both the webhook's `From` and the send's `To`, so the member's address carries
    the line's channel prefix and inbound routing matches it byte for byte."""
    channel, _, _ = line.rpartition(":")
    return f"{channel}:{phone}" if channel else phone


def signature(auth_token: str, url: str, params: Mapping[str, str]) -> str:
    """Twilio's request signature: HMAC-SHA1 over the full URL followed by every POST parameter as
    name then value, sorted by name, base64-encoded."""
    payload = url + "".join(f"{name}{params[name]}" for name in sorted(params))
    digest = hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def signature_valid(auth_token: str, url: str, params: Mapping[str, str], claimed: str) -> bool:
    return hmac.compare_digest(signature(auth_token, url, params), claimed)


def public_url(request: Request) -> str:
    """The URL Twilio signed, which is the public one: behind a tunnel or load balancer the
    request reaches the process on a private scheme and host, so the forwarded headers win."""
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers["host"]
    query = f"?{request.url.query}" if request.url.query else ""
    return f"{scheme}://{host}{request.url.path}{query}"


def segments(text: str) -> tuple[str, ...]:
    """Split a reply into texts Twilio accepts, breaking at the last line or word boundary before
    the limit, and numbering them when there is more than one."""
    remaining = text.strip()[:BODY_MAX_CHARS]
    parts: list[str] = []
    while len(remaining) > SEGMENT_MAX_CHARS:
        window = remaining[:SEGMENT_MAX_CHARS]
        cut = max(window.rfind("\n"), window.rfind(" "))
        cut = SEGMENT_MAX_CHARS if cut <= 0 else cut
        parts.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip()
    if remaining:
        parts.append(remaining)
    if len(parts) < 2:
        return tuple(parts)
    return tuple(f"{part} ({index}/{len(parts)})" for index, part in enumerate(parts, start=1))


async def send(to: str, body: str) -> str:
    """Send one reply to `to` from the deploy's line and return the first message's SID."""
    account = _present(ACCOUNT_SID_ENV, deploy_env(ACCOUNT_SID_ENV))
    sids: list[str] = []
    async with httpx.AsyncClient(
        auth=(account, auth_token()), timeout=SEND_TIMEOUT_SECONDS
    ) as client:
        for part in segments(body):
            response = await client.post(
                f"{API_BASE}/Accounts/{account}/Messages.json",
                data={"From": line_number(), "To": to, "Body": part},
            )
            response.raise_for_status()
            sids.append(str(response.json()["sid"]))
    if not sids:
        raise ValueError("an sms reply has no text to send")
    return sids[0]
