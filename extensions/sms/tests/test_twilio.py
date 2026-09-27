from ufo_ext_sms.manifest import manifest
from ufo_ext_sms.surface import render_question, twiml
from ufo_ext_sms.twilio import (
    SEGMENT_MAX_CHARS,
    channel_address,
    messages,
    segments,
    signature,
    signature_valid,
)

from ufo.sdk.surfaces import AskUserInput

TOKEN = "12345"
URL = "https://mycompany.com/myapp.php?foo=1&bar=2"
PARAMS = {
    "Digits": "1234",
    "To": "+18005551212",
    "From": "+12349013030",
    "Caller": "+12349013030",
    "CallSid": "CA1234567890ABCDE",
}


def test_signature_matches_twilio_reference() -> None:
    assert signature(TOKEN, URL, PARAMS) == "0/KCTR6DLpKmkAf8muzZqo1nDgQ="


def test_signature_rejects_tampered_body_and_url() -> None:
    claimed = signature(TOKEN, URL, PARAMS)
    assert signature_valid(TOKEN, URL, PARAMS, claimed)
    assert not signature_valid(TOKEN, URL, {**PARAMS, "Digits": "9999"}, claimed)
    assert not signature_valid(TOKEN, URL.replace("https", "http"), PARAMS, claimed)
    assert not signature_valid("other", URL, PARAMS, claimed)


def test_short_reply_is_one_unnumbered_segment() -> None:
    assert segments("  Order 3 cases of tomatoes.  ") == ("Order 3 cases of tomatoes.",)


def test_long_reply_splits_on_word_boundaries_and_numbers_parts() -> None:
    words = " ".join(f"word{index}" for index in range(600))
    parts = segments(words)
    assert len(parts) > 1
    assert all(len(part) <= SEGMENT_MAX_CHARS + len(" (9/9)") for part in parts)
    assert parts[0].endswith(f"(1/{len(parts)})")
    rejoined = " ".join(part.rsplit(" (", 1)[0] for part in parts)
    assert rejoined == words


def test_empty_reply_has_no_segments() -> None:
    assert segments("   ") == ()


def test_reply_sends_text_then_one_message_per_picture() -> None:
    line, to = "whatsapp:+19785550100", "whatsapp:+12065550123"
    assert messages(
        line, to, "Cart ready. Confirm?", ("https://a/cart.png", "https://a/total.png")
    ) == (
        {"From": line, "To": to, "Body": "Cart ready. Confirm?"},
        {"From": line, "To": to, "MediaUrl": "https://a/cart.png"},
        {"From": line, "To": to, "MediaUrl": "https://a/total.png"},
    )


def test_picture_only_reply_has_no_text_message() -> None:
    assert messages("+1", "+2", "  ", ("https://a/cart.png",)) == (
        {"From": "+1", "To": "+2", "MediaUrl": "https://a/cart.png"},
    )


def test_twiml_escapes_message() -> None:
    body = bytes(twiml("a < b & c").body).decode()
    assert "<Message>a &lt; b &amp; c</Message>" in body


def test_question_renders_numbered_options() -> None:
    asked = AskUserInput.model_validate(
        {
            "title": "Order day",
            "questions": [
                {"question": "Which day?", "options": [{"label": "Monday"}, {"label": "Friday"}]}
            ],
        }
    )
    assert render_question(asked) == "Which day?\n1. Monday\n2. Friday"


def test_surface_declares_both_writeback_phases() -> None:
    (surface,) = manifest().surfaces
    assert surface.addressed
    assert surface.post is not None
    assert surface.attach is not None


def test_whatsapp_line_prefixes_member_address() -> None:
    assert channel_address("whatsapp:+19785550100", "+12065550123") == "whatsapp:+12065550123"
    assert channel_address("+12065550100", "+12065550123") == "+12065550123"
