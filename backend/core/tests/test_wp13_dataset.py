"""WP-13: research export, statistics, and the admin dashboard.

Executable spec (docs/hivescale-plan.md, WP-13):
- the export writes the named-dimension embedding matrix + per-pairing stats with
  a stable schema and a dataset card;
- divergence / correlation metrics match hand-computed fixtures;
- the export is aggregate-only — no PII, and flagged/zero-weight answers never
  reach it (they're excluded upstream of the snapshot);
- the admin statistics page renders.
"""

import csv
import json

import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from core import dataset
from core.charts import heatmap_svg, histogram_svg
from core.models import (
    AIDistribution,
    DistributionSnapshot,
    Guess,
    Pairing,
    Player,
    Scale,
    Thing,
)
from core.services import recompute_snapshot

pytestmark = pytest.mark.django_db


# --- Fixtures ---------------------------------------------------------------


def _tight_hist(bucket: int = 10) -> list[float]:
    h = [0.0] * 20
    h[bucket] = 0.6
    h[bucket - 1] = h[bucket + 1] = 0.2
    return h


def _bimodal_hist() -> list[float]:
    h = [0.0] * 20
    h[2] = 0.5
    h[17] = 0.5
    return h


def _graduated(
    thing_i: int,
    scale_i: int,
    *,
    histogram: list[float] | None = None,
    median: float = 50.0,
    q25: float = 44.0,
    q75: float = 56.0,
    n: int = 20,
) -> Pairing:
    thing = Thing.objects.create(text=f"Thing {thing_i}", slug=f"thing-{thing_i}")
    scale = Scale.objects.create(
        left_label=f"left {scale_i}", right_label=f"right {scale_i}", slug=f"scale-{scale_i}"
    )
    pairing = Pairing.objects.create(
        thing=thing, scale=scale, n_answers=n, graduated_at=timezone.now()
    )
    DistributionSnapshot.objects.create(
        pairing=pairing, histogram=histogram or _tight_hist(),
        median=median, q25=q25, q75=q75, n=n,
    )
    return pairing


def _pair_existing(thing: Thing, scale: Scale, *, median: float, n: int = 20) -> Pairing:
    pairing = Pairing.objects.create(
        thing=thing, scale=scale, n_answers=n, graduated_at=timezone.now()
    )
    DistributionSnapshot.objects.create(
        pairing=pairing, histogram=_tight_hist(), median=median, q25=median - 6,
        q75=median + 6, n=n,
    )
    return pairing


# --- pairing_rows -----------------------------------------------------------


def test_pairing_rows_requires_min_n() -> None:
    _graduated(1, 1, n=20)
    _graduated(2, 2, n=5)  # below the default threshold
    rows = dataset.pairing_rows(min_n=15)
    assert len(rows) == 1
    assert rows[0].n == 20


def test_pairing_rows_uses_only_the_latest_snapshot() -> None:
    pairing = _graduated(1, 1, median=40.0, n=20)
    DistributionSnapshot.objects.create(
        pairing=pairing, histogram=_tight_hist(), median=70.0, q25=64, q75=76, n=25
    )
    rows = dataset.pairing_rows(min_n=15)
    assert rows[0].median == 70.0  # newest wins
    assert rows[0].n == 25


def test_shape_classification() -> None:
    tight = _graduated(1, 1, histogram=_tight_hist(), q25=48, q75=52)  # IQR 4
    wide = _graduated(2, 2, histogram=[0.05] * 20, q25=20, q75=80)  # IQR 60
    war = _graduated(3, 3, histogram=_bimodal_hist(), q25=10, q75=90)
    by_id = {r.pairing_id: r for r in dataset.pairing_rows(min_n=15)}
    assert by_id[tight.pk].shape == "tight"
    assert by_id[wide.pk].shape == "wide"
    assert by_id[war.pk].shape == "divided"
    assert by_id[war.pk].is_bimodal


# --- embedding matrix -------------------------------------------------------


def test_embedding_matrix_pivots_things_by_scales() -> None:
    thing = Thing.objects.create(text="Coffee", slug="coffee")
    s1 = Scale.objects.create(left_label="cheap", right_label="pricey", slug="s1")
    s2 = Scale.objects.create(left_label="weak", right_label="strong", slug="s2")
    _pair_existing(thing, s1, median=30.0)
    _pair_existing(thing, s2, median=80.0)

    matrix = dataset.embedding_matrix(dataset.pairing_rows(min_n=15))
    assert matrix.thing_labels == ["Coffee"]
    assert len(matrix.scale_ids) == 2
    row = matrix.values[0]
    # Columns are sorted by label: "cheap ↔ pricey" before "weak ↔ strong".
    assert list(row) == [30.0, 80.0]


# --- scale correlations (hand-computed) ------------------------------------


def test_scale_correlations_detect_aligned_and_opposed_scales() -> None:
    things = [Thing.objects.create(text=f"T{i}", slug=f"t{i}") for i in range(3)]
    a = Scale.objects.create(left_label="a", right_label="A", slug="sa")
    b = Scale.objects.create(left_label="b", right_label="B", slug="sb")
    c = Scale.objects.create(left_label="c", right_label="C", slug="sc")
    medians_a = [10.0, 50.0, 90.0]
    for t, m in zip(things, medians_a, strict=True):
        _pair_existing(t, a, median=m)
        _pair_existing(t, b, median=m)  # identical -> r = +1
        _pair_existing(t, c, median=100.0 - m)  # mirrored -> r = -1

    matrix = dataset.embedding_matrix(dataset.pairing_rows(min_n=15))
    corr, overlap = dataset.correlation_matrix(matrix, min_overlap=3)
    labels = matrix.scale_labels
    ia, ib, ic = labels.index("a ↔ A"), labels.index("b ↔ B"), labels.index("c ↔ C")
    assert corr[ia, ib] == pytest.approx(1.0)
    assert corr[ia, ic] == pytest.approx(-1.0)
    assert overlap[ia, ib] == 3

    top = dataset.top_scale_correlations(matrix, min_overlap=3, limit=5)
    assert abs(top[0].r) == pytest.approx(1.0)  # strongest link first


def test_correlation_needs_enough_overlap() -> None:
    t = Thing.objects.create(text="Solo", slug="solo")
    a = Scale.objects.create(left_label="a", right_label="A", slug="sa")
    b = Scale.objects.create(left_label="b", right_label="B", slug="sb")
    _pair_existing(t, a, median=30.0)
    _pair_existing(t, b, median=40.0)
    matrix = dataset.embedding_matrix(dataset.pairing_rows(min_n=15))
    # Only one shared thing < min_overlap -> no correlation reported.
    assert dataset.top_scale_correlations(matrix, min_overlap=3) == []


# --- highlight lists --------------------------------------------------------


def test_tightest_and_most_divided_and_ai_divergence() -> None:
    tight = _graduated(1, 1, histogram=_tight_hist(), q25=49, q75=51)
    war = _graduated(2, 2, histogram=_bimodal_hist(), q25=10, q75=90)
    # An AI prior that lands far from the crowd median (50 vs 90 -> Δ 40).
    ai_pairing = _graduated(3, 3, histogram=_tight_hist(), median=50.0)
    AIDistribution.objects.create(
        pairing=ai_pairing, model_name="gemini-x", prompt_version="v1",
        histogram=_tight_hist(bucket=18), median=90.0, q25=84, q75=96,
    )
    rows = dataset.pairing_rows(min_n=15)

    assert dataset.tightest_pairings(rows)[0].pairing_id == tight.pk
    assert dataset.most_divided_pairings(rows)[0].pairing_id == war.pk
    diverged = dataset.top_ai_divergences(rows)
    assert diverged[0].pairing_id == ai_pairing.pk
    assert diverged[0].ai_median_divergence == pytest.approx(40.0)
    # TV distance between two disjoint tight histograms is 1.0.
    assert diverged[0].ai_tv_distance == pytest.approx(1.0, abs=1e-6)


# --- charts -----------------------------------------------------------------


def test_histogram_svg_draws_bars_median_and_ai_overlay() -> None:
    svg = histogram_svg(_tight_hist(), median=50, q25=44, q75=56, ai_histogram=_tight_hist(18))
    assert svg.startswith("<svg")
    assert "<rect" in svg  # bars + IQR band
    assert "<line" in svg  # median marker
    assert "<polyline" in svg  # AI overlay


def test_heatmap_svg_escapes_labels_and_is_empty_safe() -> None:
    assert "width=\"0\"" in heatmap_svg([], [])
    svg = heatmap_svg(["a<b", "c"], [[1.0, 0.5], [0.5, 1.0]])
    assert "a&lt;b" in svg  # label escaped, no raw '<'
    assert "<rect" in svg


# --- export command ---------------------------------------------------------


def _read_csv(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.reader(fh))


def test_export_writes_the_documented_schema(tmp_path) -> None:
    from django.core.management import call_command

    thing = Thing.objects.create(text="Coffee", slug="coffee")
    s1 = Scale.objects.create(left_label="cheap", right_label="pricey", slug="s1")
    s2 = Scale.objects.create(left_label="weak", right_label="strong", slug="s2")
    _pair_existing(thing, s1, median=30.0)
    _pair_existing(thing, s2, median=80.0)

    out = tmp_path / "dataset"
    call_command("export_dataset", str(out))

    for name in ["embedding_matrix.csv", "pairings.csv", "histograms.csv",
                 "scale_correlations.csv", "things.csv", "scales.csv",
                 "dataset_card.md", "manifest.json"]:
        assert (out / name).exists(), name

    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["dataset_version"] == dataset.DATASET_VERSION
    assert manifest["n_things"] == 1
    assert manifest["n_scales"] == 2

    matrix = _read_csv(out / "embedding_matrix.csv")
    assert matrix[0] == ["thing_id", "thing", "cheap ↔ pricey", "weak ↔ strong"]
    assert matrix[1][1:] == ["Coffee", "30.0000", "80.0000"]

    pairings = _read_csv(out / "pairings.csv")
    assert pairings[0][:8] == [
        "pairing_id", "thing_id", "thing", "scale_id", "scale_left",
        "scale_right", "scale_label", "n",
    ]


def test_export_is_aggregate_only_and_carries_no_pii(tmp_path) -> None:
    from django.core.management import call_command

    # A claimed player whose token/email must never surface in the export.
    user = get_user_model().objects.create(username="spy@example.com", email="spy@example.com")
    player = Player.objects.create(device_token="SECRET-DEVICE-TOKEN", user=user)
    pairing = _graduated(1, 1)
    Guess.objects.create(
        pairing=pairing, player=player, center=50.0, width_left=5, width_right=5,
        response_ms=4000,
    )

    out = tmp_path / "dataset"
    call_command("export_dataset", str(out))

    blob = "\n".join(p.read_text(encoding="utf-8") for p in out.iterdir())
    assert "SECRET-DEVICE-TOKEN" not in blob
    assert "spy@example.com" not in blob
    assert str(player.pk) not in _read_csv(out / "pairings.csv")[0]  # no player columns


def test_export_median_excludes_flagged_and_zero_weight_answers(tmp_path) -> None:
    from django.core.management import call_command

    thing = Thing.objects.create(text="Espresso", slug="espresso")
    scale = Scale.objects.create(left_label="mild", right_label="intense", slug="sc")
    pairing = Pairing.objects.create(thing=thing, scale=scale)
    crowd = Player.objects.create(device_token="crowd")
    troll = Player.objects.create(device_token="troll", weight=0.0)

    # 15 honest answers clustered at ~50.
    for _ in range(15):
        Guess.objects.create(
            pairing=pairing, player=crowd, center=50.0, width_left=5, width_right=5,
            response_ms=4000,
        )
    # A too-fast answer and a zero-weight troll, both far away — must not move it.
    Guess.objects.create(
        pairing=pairing, player=crowd, center=100.0, width_left=5, width_right=5,
        response_ms=200, quality_flags=["too_fast"],
    )
    Guess.objects.create(
        pairing=pairing, player=troll, center=0.0, width_left=5, width_right=5,
        response_ms=4000,
    )
    recompute_snapshot(pairing)

    out = tmp_path / "dataset"
    call_command("export_dataset", str(out))
    rows = _read_csv(out / "pairings.csv")
    median = float(rows[1][8])
    assert median == pytest.approx(50.0, abs=1.0)  # excluded answers didn't shift it


def test_export_errors_cleanly_when_there_is_no_data(tmp_path) -> None:
    from django.core.management import call_command
    from django.core.management.base import CommandError

    with pytest.raises(CommandError):
        call_command("export_dataset", str(tmp_path / "empty"))


# --- admin dashboard --------------------------------------------------------


def test_stats_dashboard_renders_for_staff() -> None:
    _graduated(1, 1, histogram=_bimodal_hist(), q25=10, q75=90)
    admin = get_user_model().objects.create_superuser("root", "root@example.com", "pw")
    client = Client()
    client.force_login(admin)

    url = reverse("admin:core_datasetstats_changelist")
    response = client.get(url)
    assert response.status_code == 200
    assert b"Scale correlations" in response.content
    assert b"Society is at war" in response.content


def test_stats_dashboard_handles_an_empty_dataset() -> None:
    admin = get_user_model().objects.create_superuser("root", "root@example.com", "pw")
    client = Client()
    client.force_login(admin)
    response = client.get(reverse("admin:core_datasetstats_changelist"))
    assert response.status_code == 200
    assert b"No pairings have graduated yet" in response.content
