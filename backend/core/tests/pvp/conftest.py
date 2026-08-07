"""Shared fixtures for the PvP suite.

The round barrier is a *long poll*: when only one player is ready the request
parks for ``PVP_READY_POLL_SECONDS`` (20s in production) before answering "still
waiting". A test client is single-threaded, so the second player can never arrive
mid-request — every such call would simply burn the full window, which is real
sleeping, not real coverage.

Collapsing the window to zero makes ``wait_for_start`` a single non-blocking
check, which is exactly the state those tests assert on ("waiting" vs "released").
The waiting behaviour itself is still covered explicitly by
``test_wait_for_start_returns_none_when_the_other_player_never_arrives``.
"""

import pytest
from django.test import override_settings


@pytest.fixture(autouse=True)
def _instant_ready_poll():
    """Don't really sleep through the barrier's long-poll window in tests."""
    with override_settings(PVP_READY_POLL_SECONDS=0.0, PVP_READY_TICK_SECONDS=0.0):
        yield
