from django.contrib import admin

from core.models import (
    AIDistribution,
    DailyWave,
    DistributionSnapshot,
    Guess,
    Pairing,
    Player,
    RoundScore,
    Scale,
    Thing,
)


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ("device_token", "level", "xp", "weight", "created_at")
    search_fields = ("device_token",)


@admin.register(Thing)
class ThingAdmin(admin.ModelAdmin):
    list_display = ("text", "slug", "status", "language", "created_by", "created_at")
    list_filter = ("status", "language")
    search_fields = ("text",)
    prepopulated_fields = {"slug": ("text",)}


@admin.register(Scale)
class ScaleAdmin(admin.ModelAdmin):
    list_display = ("left_label", "right_label", "status", "created_by", "created_at")
    list_filter = ("status",)
    search_fields = ("left_label", "right_label")


@admin.register(Pairing)
class PairingAdmin(admin.ModelAdmin):
    list_display = ("thing", "scale", "status", "n_answers", "graduated_at")
    list_filter = ("status",)
    list_select_related = ("thing", "scale")


@admin.register(Guess)
class GuessAdmin(admin.ModelAdmin):
    list_display = ("pairing", "player", "center", "width_left", "width_right",
                    "response_ms", "quality_flags", "created_at")
    list_select_related = ("pairing__thing", "pairing__scale", "player")

    def has_change_permission(self, request, obj=None) -> bool:
        return False  # append-only dataset, also in the admin


@admin.register(DistributionSnapshot)
class DistributionSnapshotAdmin(admin.ModelAdmin):
    list_display = ("pairing", "n", "median", "q25", "q75", "computed_at")
    list_select_related = ("pairing__thing", "pairing__scale")


@admin.register(AIDistribution)
class AIDistributionAdmin(admin.ModelAdmin):
    list_display = ("pairing", "model_name", "prompt_version", "median", "created_at")
    list_filter = ("model_name", "prompt_version")


@admin.register(RoundScore)
class RoundScoreAdmin(admin.ModelAdmin):
    list_display = ("guess", "visible_points", "crps", "created_at")


@admin.register(DailyWave)
class DailyWaveAdmin(admin.ModelAdmin):
    list_display = ("date", "pairing_count")

    @admin.display(description="pairings")
    def pairing_count(self, obj: DailyWave) -> int:
        return len(obj.pairing_ids)
