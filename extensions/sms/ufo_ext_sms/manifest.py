"""What the sms extension declares: the addressed, durable `sms` surface on the deploy's Twilio
line, the `connect_sms_phone` tool that joins a member's phone to it, and the prompt section that
shapes replies for a phone screen."""

from pathlib import Path

from ufo.sdk.manifest import Manifest, PromptSection
from ufo.sdk.surfaces import SurfaceRoute, SurfaceSpec
from ufo_ext_sms.surface import INBOUND_PATH, SURFACE_NAME, attach, identify, inbound, post
from ufo_ext_sms.tools import CONNECT_PHONE
from ufo_ext_sms.twilio import ACCOUNT_SID_ENV, AUTH_TOKEN_ENV, LINE_NUMBER_ENV

NAME = "sms"
VERSION = "0.1.0"
SECTION_NAME = "sms"
SECTION_BODY = (Path(__file__).parent / "prompts" / "sms_section.md").read_text().strip()


def manifest() -> Manifest:
    return Manifest(
        name=NAME,
        version=VERSION,
        tools=(CONNECT_PHONE,),
        surfaces=(
            SurfaceSpec(
                name=SURFACE_NAME,
                routes=(SurfaceRoute(method="POST", path=INBOUND_PATH, handler=inbound),),
                identify=identify,
                post=post,
                attach=attach,
                addressed=True,
            ),
        ),
        prompt_sections=(PromptSection(name=SECTION_NAME, body=SECTION_BODY),),
        deploy_keys=(ACCOUNT_SID_ENV, AUTH_TOKEN_ENV, LINE_NUMBER_ENV),
    )
