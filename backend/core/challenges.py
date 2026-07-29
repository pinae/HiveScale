"""Thing challenges (plan §2.x, unlocked at level 10).

The player is shown two random scales and asked to name a thing (≤3 words) that
sits at the *max* of the first scale and the *min* of the second — a creative
prompt that mines fresh, well-characterised Things for the pool. A completed
challenge pays a flat, generous bonus: ten normal rounds at a ×5 multiplier.

Challenges are stateless — a signed token binds the two scales to the player, so
there is nothing to persist beyond the Thing that gets created.
"""

import random
import time as _time

from django.conf import settings
from django.core import signing

from core import leveling
from core.content import is_clean
from core.content_api import _unique_slug
from core.models import ContentStatus, Scale, Thing
from core.tasks import schedule_sanity_check

#: A completed challenge is worth ten normal rounds banked at a ×5 multiplier.
NORMAL_ROUND_SCORE = 500
CHALLENGE_MULTIPLIER = 5
CHALLENGE_ROUNDS_WORTH = 10
CHALLENGE_XP = CHALLENGE_ROUNDS_WORTH * NORMAL_ROUND_SCORE * CHALLENGE_MULTIPLIER  # 25_000

MAX_WORDS = 3
_CHALLENGE_SALT = "hivescale.thing-challenge"
#: A dealt challenge stays answerable for ten minutes.
CHALLENGE_TOKEN_MAX_AGE = 60 * 10


def challenge_level() -> int:
    return int(getattr(settings, "CONTENT_CHALLENGE_LEVEL", 10))


def pick_two_scales(rng: random.Random | None = None) -> tuple[Scale, Scale] | None:
    """Two distinct active scales — the 'fits max' and 'fits min' poles."""
    rng = rng or random.Random()
    ids = list(Scale.objects.filter(status=ContentStatus.ACTIVE).values_list("id", flat=True))
    if len(ids) < 2:
        return None
    first_id, second_id = rng.sample(ids, 2)
    return Scale.objects.get(pk=first_id), Scale.objects.get(pk=second_id)


def issue_token(player, first: Scale, second: Scale) -> str:
    """Sign a challenge ticket binding the two scales to the player."""
    return signing.dumps(
        {"u": player.pk, "a": first.pk, "b": second.pk, "ts": _time.time()},
        salt=_CHALLENGE_SALT,
    )


def load_token(token: str) -> dict:
    """Raise ``signing.BadSignature`` if invalid/expired; else return the ticket."""
    return signing.loads(token, salt=_CHALLENGE_SALT, max_age=CHALLENGE_TOKEN_MAX_AGE)


def is_valid_answer(text: str) -> bool:
    return 1 <= len(text) <= 120 and 1 <= len(text.split()) <= MAX_WORDS and is_clean(text)


def submit(player, first: Scale, second: Scale, text: str) -> dict:
    """Create the suggested Thing (DRAFT → sanity check), bank the bonus, re-level."""
    thing = Thing.objects.create(
        text=text,
        slug=_unique_slug(Thing, text),
        status=ContentStatus.DRAFT,
        created_by=player,
    )
    schedule_sanity_check("thing", thing.pk)

    player.xp += CHALLENGE_XP
    player.level = leveling.level_for_xp(player.xp)
    player.save(update_fields=["xp", "level"])

    return {"thing_id": thing.pk, "text": thing.text, "xp_awarded": CHALLENGE_XP}
