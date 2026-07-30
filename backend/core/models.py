"""Domain models (plan §3.2).

Data-integrity rules enforced here rather than in views:
- ``Pairing`` is unique per (thing, scale).
- ``Guess`` rows are immutable — the dataset is append-only by construction.
- Guess geometry is checked at the database level (center on scale, widths >= 0).
- ``AIDistribution`` is a separate table from ``DistributionSnapshot`` so the
  human baseline can never be polluted by model output (plan §1.5).
"""

from django.conf import settings
from django.db import models
from django.db.models import Q


class ContentStatus(models.TextChoices):
    DRAFT = "draft"  # submitted; awaiting sanity check or human moderation
    ACTIVE = "active"
    RETIRED = "retired"
    REJECTED = "rejected"  # failed the profanity/PII filter or the sanity check


class Player(models.Model):
    """A participant; anonymous (device token) until claimed (WP-04)."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    device_token = models.CharField(max_length=64, unique=True)
    level = models.PositiveIntegerField(default=1)
    xp = models.PositiveIntegerField(default=0)
    xp_multiplier = models.PositiveIntegerField(
        default=1, help_text="Calibration multiplier (×1–×10); grows on well-covered rounds."
    )
    hot_streak = models.PositiveIntegerField(default=0, help_text="Consecutive good rounds.")
    daily_streak = models.PositiveIntegerField(default=0, help_text="Consecutive days played.")
    last_played_on = models.DateField(null=True, blank=True)
    last_scale_request_on = models.DateField(
        null=True, blank=True, help_text="Day of the player's last scale request (once/day)."
    )
    streak_freezes = models.PositiveIntegerField(default=0, help_text="Missed-day protections.")
    calibration_stats = models.JSONField(default=dict, blank=True)
    weight = models.FloatField(default=1.0, help_text="Baseline weight; 0 excludes silently.")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Player {self.device_token[:12]} (lvl {self.level})"


class Thing(models.Model):
    text = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    status = models.CharField(
        max_length=10, choices=ContentStatus.choices, default=ContentStatus.ACTIVE
    )
    created_by = models.ForeignKey(
        Player, null=True, blank=True, on_delete=models.SET_NULL, related_name="things"
    )
    language = models.CharField(max_length=8, default="en")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.text


class Scale(models.Model):
    left_label = models.CharField(max_length=60)
    right_label = models.CharField(max_length=60)
    slug = models.SlugField(max_length=140, unique=True)
    status = models.CharField(
        max_length=10, choices=ContentStatus.choices, default=ContentStatus.ACTIVE
    )
    created_by = models.ForeignKey(
        Player, null=True, blank=True, on_delete=models.SET_NULL, related_name="scales"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.left_label} ↔ {self.right_label}"


class Pairing(models.Model):
    thing = models.ForeignKey(Thing, on_delete=models.CASCADE, related_name="pairings")
    scale = models.ForeignKey(Scale, on_delete=models.CASCADE, related_name="pairings")
    status = models.CharField(
        max_length=10, choices=ContentStatus.choices, default=ContentStatus.ACTIVE
    )
    n_answers = models.PositiveIntegerField(default=0)
    graduated_at = models.DateTimeField(null=True, blank=True)
    voting_disabled = models.BooleanField(
        default=False, help_text="Exclude from the fun/boring vote (admin or auto-flagged)."
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["thing", "scale"], name="unique_thing_scale"),
        ]

    def __str__(self) -> str:
        return f"{self.thing} on {self.scale}"

    @property
    def graduated(self) -> bool:
        return self.graduated_at is not None


class DatasetStats(Pairing):
    """Admin-only proxy: a home for the research statistics dashboard (WP-13).

    Adds no table — it exists so the aggregate stats page (scale correlations,
    tight vs. divided distributions, AI blind spots) has a discoverable slot in
    the Django admin without cluttering the real content models.
    """

    class Meta:
        proxy = True
        verbose_name = "Research statistic"
        verbose_name_plural = "Research statistics"


class VoteChoice(models.TextChoices):
    FUN = "fun"
    INTERESTING = "interesting"
    BORING = "boring"
    WEIRD = "weird"


class PairingVote(models.Model):
    """A player's fun/boring/interesting/weird vote on a thing+scale (plan §2.x).

    Keyed on the *combination*, not a Pairing row, so votes work both for
    existing pairings and for candidate combinations that don't exist yet.
    """

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="pairing_votes")
    thing = models.ForeignKey(Thing, on_delete=models.CASCADE, related_name="pairing_votes")
    scale = models.ForeignKey(Scale, on_delete=models.CASCADE, related_name="pairing_votes")
    choice = models.CharField(max_length=12, choices=VoteChoice.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["player", "thing", "scale"], name="one_vote_per_player_and_pairing"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.choice} on {self.thing_id}+{self.scale_id} by {self.player_id}"


class Guess(models.Model):
    """One player answer. Immutable: the dataset is append-only."""

    pairing = models.ForeignKey(Pairing, on_delete=models.CASCADE, related_name="guesses")
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="guesses")
    center = models.FloatField()
    width_left = models.FloatField()
    width_right = models.FloatField()
    response_ms = models.PositiveIntegerField()
    quality_flags = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["pairing", "created_at"])]
        constraints = [
            models.CheckConstraint(
                condition=Q(center__gte=0) & Q(center__lte=100), name="guess_center_on_scale"
            ),
            models.CheckConstraint(
                condition=Q(width_left__gte=0) & Q(width_right__gte=0),
                name="guess_widths_non_negative",
            ),
        ]

    def __str__(self) -> str:
        return f"Guess {self.center:.1f} on pairing {self.pairing_id}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError("Guess rows are immutable; create a new guess instead.")
        return super().save(*args, **kwargs)


class DistributionSnapshot(models.Model):
    """Cached human-baseline used as the scoring target (plan §1.7)."""

    pairing = models.ForeignKey(Pairing, on_delete=models.CASCADE, related_name="snapshots")
    histogram = models.JSONField()
    median = models.FloatField()
    q25 = models.FloatField()
    q75 = models.FloatField()
    n = models.PositiveIntegerField()
    computed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["pairing", "-computed_at"])]
        get_latest_by = "computed_at"

    def __str__(self) -> str:
        return f"Snapshot(pairing={self.pairing_id}, n={self.n}, median={self.median:.1f})"


class AIDistribution(models.Model):
    """LLM prior for a pairing. Research artifact — never part of the baseline."""

    pairing = models.ForeignKey(Pairing, on_delete=models.CASCADE, related_name="ai_distributions")
    model_name = models.CharField(max_length=80)
    prompt_version = models.CharField(max_length=40)
    histogram = models.JSONField()
    median = models.FloatField()
    q25 = models.FloatField()
    q75 = models.FloatField()
    rationale = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["pairing", "model_name", "prompt_version"],
                name="unique_ai_estimate_per_model_and_prompt",
            ),
        ]

    def __str__(self) -> str:
        return f"AI({self.model_name}/{self.prompt_version}) for pairing {self.pairing_id}"


class RoundScore(models.Model):
    """Reproducible scoring record for one guess (visible + hidden layers)."""

    guess = models.OneToOneField(Guess, on_delete=models.CASCADE, related_name="score")
    visible_points = models.FloatField()
    crps = models.FloatField(null=True, blank=True)
    components = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Score {self.visible_points:.0f} for guess {self.guess_id}"


class DailyWave(models.Model):
    """The shared daily set: same ordered pairings for everyone (plan §2.2)."""

    date = models.DateField(unique=True)
    pairing_ids = models.JSONField(default=list)

    def __str__(self) -> str:
        return f"DailyWave {self.date} ({len(self.pairing_ids)} pairings)"


class DailyWaveEntry(models.Model):
    """One player's answer to one slot of a day's Daily Wave (plan §2.2).

    Records progress and the per-slot visible score so a wave is answered once,
    in order, and can be summarised into the shareable emoji result.
    """

    wave = models.ForeignKey(DailyWave, on_delete=models.CASCADE, related_name="entries")
    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="daily_wave_entries"
    )
    index = models.PositiveIntegerField()
    guess = models.OneToOneField(
        Guess, on_delete=models.CASCADE, related_name="daily_wave_entry"
    )
    visible_points = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["index"]
        constraints = [
            models.UniqueConstraint(
                fields=["wave", "player", "index"], name="unique_daily_wave_slot"
            ),
        ]

    def __str__(self) -> str:
        return f"DailyWaveEntry(wave={self.wave_id}, player={self.player_id}, i={self.index})"
