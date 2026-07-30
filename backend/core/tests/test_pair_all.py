"""`manage.py pair_all`: idempotent full cross-product of active content."""

import pytest
from django.core.management import call_command

from core.models import ContentStatus, Pairing, Scale, Thing

pytestmark = pytest.mark.django_db


def _thing(i: int, status: str = ContentStatus.ACTIVE) -> Thing:
    return Thing.objects.create(text=f"Thing {i}", slug=f"thing-{i}", status=status)


def _scale(i: int, status: str = ContentStatus.ACTIVE) -> Scale:
    return Scale.objects.create(
        left_label=f"l{i}", right_label=f"r{i}", slug=f"scale-{i}", status=status
    )


def test_creates_every_active_combo_with_voting_enabled():
    things = [_thing(i) for i in range(3)]
    scales = [_scale(i) for i in range(4)]

    call_command("pair_all")

    assert Pairing.objects.count() == len(things) * len(scales)
    for pairing in Pairing.objects.all():
        assert pairing.status == ContentStatus.ACTIVE
        assert pairing.voting_disabled is False


def test_is_idempotent():
    for i in range(3):
        _thing(i)
        _scale(i)
    call_command("pair_all")
    first = set(Pairing.objects.values_list("thing_id", "scale_id"))

    call_command("pair_all")  # again
    assert Pairing.objects.count() == 9
    assert set(Pairing.objects.values_list("thing_id", "scale_id")) == first


def test_keeps_existing_pairings_untouched():
    thing, scale = _thing(0), _scale(0)
    _thing(1), _scale(1)
    # A pre-existing pairing an admin retired and disabled from voting.
    existing = Pairing.objects.create(
        thing=thing, scale=scale, status=ContentStatus.REJECTED, voting_disabled=True, n_answers=7
    )

    call_command("pair_all")

    existing.refresh_from_db()
    assert existing.status == ContentStatus.REJECTED  # not flipped back to ACTIVE
    assert existing.voting_disabled is True
    assert existing.n_answers == 7
    # The other three combinations were filled in.
    assert Pairing.objects.count() == 4


def test_only_pairs_active_things_and_scales():
    _thing(0)  # active
    _thing(1, status=ContentStatus.DRAFT)  # awaiting moderation
    _scale(0)  # active
    _scale(1, status=ContentStatus.REJECTED)

    call_command("pair_all")

    # Only the single active×active combo is created.
    assert Pairing.objects.count() == 1
    pairing = Pairing.objects.get()
    assert pairing.thing.status == ContentStatus.ACTIVE
    assert pairing.scale.status == ContentStatus.ACTIVE
