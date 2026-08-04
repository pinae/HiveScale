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
