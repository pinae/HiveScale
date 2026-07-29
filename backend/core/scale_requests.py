"""Player-authored scales (plan §2.x, unlocked at level 15).

Once a day — and only after the player has warmed up with a few rounds — a random
thing is chosen and the player is asked to invent a *surprising* new scale for it.
To steer them away from the obvious, the prompt shows the thing's most-popular
existing scales as "already taken" examples. The new scale is filed for
moderation and paired with the thing so it can enter play once approved.
"""

import datetime
import random
import time as _time

from django.conf import settings
from django.core import signing
from django.db import transaction

from core.content import is_clean
from core.content_api import _unique_slug
from core.models import ContentStatus, Pairing, Scale, Thing

_SALT = "hivescale.scale-request"
SCALE_REQUEST_TOKEN_MAX_AGE = 60 * 30
#: How many of the thing's existing scales to show as "don't repeat these".
MAX_EXAMPLES = 7


def scale_request_level() -> int:
    return int(getattr(settings, "CONTENT_SCALE_LEVEL", 15))


def min_rounds() -> int:
    return int(getattr(settings, "CONTENT_SCALE_MIN_ROUNDS", 5))


def rounds_played_on(player, day: datetime.date) -> int:
    return player.guesses.filter(created_at__date=day).count()


def availability(player, day: datetime.date) -> dict:
    """Whether a scale request is on offer today, and if not, why not."""
    if player.last_scale_request_on == day:
        return {
            "available": False,
            "reason": "You've already crafted a scale today — back tomorrow.",
        }
    played = rounds_played_on(player, day)
    if played < min_rounds():
        return {
            "available": False,
            "reason": f"Play {min_rounds()} rounds today first ({played}/{min_rounds()}).",
        }
    return {"available": True}


def pick_thing(rng: random.Random | None = None) -> Thing | None:
    rng = rng or random.Random()
    ids = list(Thing.objects.filter(status=ContentStatus.ACTIVE).values_list("id", flat=True))
    return Thing.objects.get(pk=rng.choice(ids)) if ids else None


def example_scales(thing: Thing) -> list[dict]:
    """The thing's existing scales, most-played first — what *not* to pick."""
    pairings = (
        Pairing.objects.filter(thing=thing, scale__status=ContentStatus.ACTIVE)
        .select_related("scale")
        .order_by("-n_answers")[:MAX_EXAMPLES]
    )
    return [{"left": p.scale.left_label, "right": p.scale.right_label} for p in pairings]


def issue_token(player, thing: Thing) -> str:
    return signing.dumps({"u": player.pk, "t": thing.pk, "ts": _time.time()}, salt=_SALT)


def load_token(token: str) -> dict:
    return signing.loads(token, salt=_SALT, max_age=SCALE_REQUEST_TOKEN_MAX_AGE)


def is_valid_scale(left: str, right: str) -> bool:
    return 1 <= len(left) <= 60 and 1 <= len(right) <= 60 and is_clean(left, right)


@transaction.atomic
def submit(player, thing: Thing, left: str, right: str, day: datetime.date) -> dict:
    """Create the new scale (DRAFT → sanity check), pair it with the thing, and
    record the daily request so no second one is offered today."""
    from core.tasks import schedule_sanity_check

    scale = Scale.objects.create(
        left_label=left,
        right_label=right,
        slug=_unique_slug(Scale, f"{left}-{right}"),
        status=ContentStatus.DRAFT,
        created_by=player,
    )
    schedule_sanity_check("scale", scale.pk)
    # Pair it with the prompt thing; the pairing only becomes playable once the
    # scale passes moderation (play/deal filters require an ACTIVE scale).
    pairing, _ = Pairing.objects.get_or_create(thing=thing, scale=scale)

    player.last_scale_request_on = day
    player.save(update_fields=["last_scale_request_on"])

    return {
        "scale_id": scale.pk,
        "left": scale.left_label,
        "right": scale.right_label,
        "pairing_id": pairing.pk,
    }
