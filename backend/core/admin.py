from django.contrib import admin
from django.template.response import TemplateResponse
from django.utils.safestring import mark_safe

from bglib.scoring import detect_bimodality
from core.models import (
    AIDistribution,
    DailyWave,
    DatasetStats,
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


class ModerationAdmin(admin.ModelAdmin):
    """Shared moderation actions for player-submitted content (WP-11)."""

    actions = ("approve_submissions", "reject_submissions")

    @admin.action(description="Approve selected (publish)")
    def approve_submissions(self, request, queryset):
        from core.content import approve

        for obj in queryset:
            approve(obj)
        self.message_user(request, f"Approved {queryset.count()} item(s).")

    @admin.action(description="Reject selected")
    def reject_submissions(self, request, queryset):
        from core.content import reject

        for obj in queryset:
            reject(obj)
        self.message_user(request, f"Rejected {queryset.count()} item(s).")


@admin.register(Thing)
class ThingAdmin(ModerationAdmin):
    list_display = ("text", "slug", "status", "language", "created_by", "created_at")
    list_filter = ("status", "language")
    search_fields = ("text",)
    prepopulated_fields = {"slug": ("text",)}


@admin.register(Scale)
class ScaleAdmin(ModerationAdmin):
    list_display = ("left_label", "right_label", "status", "created_by", "created_at")
    list_filter = ("status",)
    search_fields = ("left_label", "right_label")


@admin.register(Pairing)
class PairingAdmin(admin.ModelAdmin):
    list_display = ("thing", "scale", "status", "n_answers", "graduated_at", "voting_disabled")
    list_filter = ("status", "voting_disabled")
    list_editable = ("voting_disabled",)
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
    list_display = ("pairing", "n", "median", "spread", "shape", "computed_at")
    list_select_related = ("pairing__thing", "pairing__scale")
    readonly_fields = ("distribution",)

    @admin.display(description="IQR")
    def spread(self, obj: DistributionSnapshot) -> str:
        return f"{obj.q75 - obj.q25:.1f}"

    @admin.display(description="shape")
    def shape(self, obj: DistributionSnapshot) -> str:
        if detect_bimodality([float(x) for x in obj.histogram]).is_bimodal:
            return "⚔️ divided"
        iqr = obj.q75 - obj.q25
        return "🎯 tight" if iqr <= 12 else ("🌫️ wide" if iqr >= 30 else "· normal")

    @admin.display(description="crowd distribution")
    def distribution(self, obj: DistributionSnapshot) -> str:
        from core.charts import histogram_svg

        ai = obj.pairing.ai_distributions.order_by("-created_at").first()
        return mark_safe(  # noqa: S308 - our own trusted SVG builder
            histogram_svg(
                [float(x) for x in obj.histogram],
                median=obj.median, q25=obj.q25, q75=obj.q75,
                ai_histogram=[float(x) for x in ai.histogram] if ai else None,
                width=360, height=110,
            )
        )


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


#: Cap the correlation heatmap to the best-covered scales so the grid stays legible.
_HEATMAP_MAX_SCALES = 15


@admin.register(DatasetStats)
class DatasetStatsAdmin(admin.ModelAdmin):
    """Read-only research dashboard: scale correlations, tight vs. divided
    distributions, and AI blind spots — rendered as inline SVG (WP-13)."""

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False

    def changelist_view(self, request, extra_context=None):
        from core import dataset

        rows = dataset.pairing_rows()
        context = {
            **self.admin_site.each_context(request),
            "title": "Research statistics",
            "rows": rows,
            "n_pairings": len(rows),
        }

        if rows:
            matrix = dataset.embedding_matrix(rows)
            context["n_things"] = len(matrix.thing_ids)
            context["n_scales"] = len(matrix.scale_ids)
            context["heatmap"] = mark_safe(_heatmap(matrix))  # noqa: S308
            context["correlations"] = dataset.top_scale_correlations(matrix, limit=15)
            context["tightest"] = [_with_chart(r) for r in dataset.tightest_pairings(rows)]
            context["divided"] = [_with_chart(r) for r in dataset.most_divided_pairings(rows)]
            context["ai_divergences"] = [
                _with_chart(r, ai=True) for r in dataset.top_ai_divergences(rows)
            ]

        return TemplateResponse(request, "admin/core/dataset_stats.html", context)


def _with_chart(row, ai: bool = False):
    """Attach a rendered histogram SVG to a PairingRow for the template.

    When ``ai`` is set the AI prior is overlaid (red line) so the human/AI gap is
    visible; otherwise just the crowd distribution is drawn.
    """
    from core.charts import histogram_svg

    svg = histogram_svg(
        row.histogram,
        median=row.median, q25=row.q25, q75=row.q75,
        ai_histogram=row.ai_histogram if ai else None,
    )
    return {"row": row, "chart": mark_safe(svg)}  # noqa: S308


def _heatmap(matrix) -> str:
    """Render the correlation heatmap for the best-covered scales."""
    import numpy as np

    from core import charts, dataset

    coverage = np.sum(~np.isnan(matrix.values), axis=0)
    keep = list(np.argsort(coverage)[::-1][:_HEATMAP_MAX_SCALES])
    keep.sort()
    labels = [matrix.scale_labels[j] for j in keep]

    corr, _overlap = dataset.correlation_matrix(matrix)
    sub = corr[np.ix_(keep, keep)]
    return charts.heatmap_svg(labels, sub.tolist())
