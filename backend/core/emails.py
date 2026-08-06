"""Transactional email (WP-11): the account-claim magic link.

Kept apart from the view so it is easy to test and to reuse. Whether mail is
actually sent is decided by the caller via ``settings.CLAIM_LINK_DELIVERY``
("echo" returns the token in the API response; "email" calls
:func:`send_claim_link`). The message goes out through Django's configured
``EMAIL_BACKEND`` — the SMTP settings in ``config/settings.py``.
"""

from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail

#: Magic links expire after this long (kept in step with the view's token max-age).
CLAIM_LINK_TTL_MINUTES = 30


def claim_link_url(token: str) -> str:
    """The player-facing URL that finishes a claim (the SPA reads ``?claim=``)."""
    return f"{settings.PUBLIC_BASE_URL}/?claim={token}"


def pvp_invite_url(join_code: str, claim_token: str | None = None) -> str:
    """The link a challenged friend opens: joins the battle, optionally claiming
    their account on the way in (so the match has a real, reachable opponent)."""
    base = f"{settings.PUBLIC_BASE_URL}/?pvp={join_code}"
    return f"{base}&claim={claim_token}" if claim_token else base


def send_pvp_invite(email: str, join_code: str, challenger_label: str) -> None:
    """Email a battle challenge, with a link that claims/links the friend's account.

    Same magic-link machinery as :func:`send_claim_link`, different story: the
    recipient is being challenged, and by whom (the challenger's own saved email,
    which is why an unclaimed player can't send these).
    """
    from django.core import signing

    # Same salt/shape as the account-claim link, so opening it saves their progress
    # to this address exactly like a normal claim.
    claim_token = signing.dumps({"email": email}, salt="hivescale.claim")
    url = pvp_invite_url(join_code, claim_token)
    subject = f"{challenger_label} challenged you to a HiveScale battle"
    body = (
        "Hi,\n\n"
        f"{challenger_label} has challenged you to a HiveScale battle — the same "
        "ten questions for both of you, head to head. Whoever reads the hive mind "
        "better wins.\n\n"
        f"Take the challenge:\n\n{url}\n\n"
        "The link also saves your progress to this email address, so your XP and "
        "streaks are kept. If you don't know who this is, you can ignore this email.\n"
    )
    send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)


def send_claim_link(email: str, token: str) -> None:
    """Email the account-claim magic link to ``email``.

    Raises whatever the email backend raises (SMTP/connection errors) so the
    caller can report a failure rather than silently dropping the link.
    """
    url = claim_link_url(token)
    subject = "Save your HiveScale progress"
    body = (
        "Hi,\n\n"
        "Tap the link below to save your HiveScale progress — your XP, streaks, "
        "and history — to this email address:\n\n"
        f"{url}\n\n"
        f"The link works for {CLAIM_LINK_TTL_MINUTES} minutes. If you didn't ask "
        "to save your progress, you can safely ignore this email.\n"
    )
    send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
