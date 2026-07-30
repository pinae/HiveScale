"""``manage.py export_dataset`` — the HiveScale research export (WP-13).

Writes the crowd dataset as a set of plain, versioned files:

- ``embedding_matrix.csv`` — the headline artifact: one row per Thing, one column
  per Scale, cell = the crowd median (0-100). This *is* the named-dimension
  embedding (train e.g. an embedding model whose axes are the Scales).
- ``pairings.csv`` — per-pairing summary stats (median, IQR, spread, bimodality,
  AI divergence, shape).
- ``histograms.csv`` — the full 20-bucket crowd distribution per pairing.
- ``scale_correlations.csv`` — which Scales move together.
- ``things.csv`` / ``scales.csv`` — dimension metadata.
- ``dataset_card.md`` — fields, licensing intent, and known biases.
- ``manifest.json`` — version, generation time, row counts, and the filters used.

The export reads only aggregate snapshots (flagged / too-fast / zero-weight
answers already excluded upstream), so it contains **no PII**. CSV/JSON need no
extra dependencies; pass ``--parquet`` to also write Parquet (needs pyarrow).
"""

from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from django.core.management.base import BaseCommand, CommandError

from bglib.scoring import N_BUCKETS
from core import dataset


class Command(BaseCommand):
    help = "Export the crowd dataset (embedding matrix + stats) to a directory."

    def add_arguments(self, parser):
        parser.add_argument("output_dir", help="Directory to write the dataset into.")
        parser.add_argument(
            "--min-n",
            type=int,
            default=dataset.DEFAULT_MIN_N,
            help=f"Minimum answers per pairing to include (default {dataset.DEFAULT_MIN_N}).",
        )
        parser.add_argument(
            "--parquet",
            action="store_true",
            help="Also write Parquet copies (requires pyarrow).",
        )

    def handle(self, *args, **options):
        out = Path(options["output_dir"])
        out.mkdir(parents=True, exist_ok=True)
        min_n = options["min_n"]

        rows = dataset.pairing_rows(min_n=min_n)
        if not rows:
            raise CommandError(
                f"No pairings have >= {min_n} eligible answers yet — nothing to export."
            )
        matrix = dataset.embedding_matrix(rows)
        correlations = dataset.top_scale_correlations(matrix, limit=10_000)

        self._write_pairings(out / "pairings.csv", rows)
        self._write_histograms(out / "histograms.csv", rows)
        self._write_matrix(out / "embedding_matrix.csv", matrix)
        self._write_things(out / "things.csv", matrix)
        self._write_scales(out / "scales.csv", matrix)
        self._write_correlations(out / "scale_correlations.csv", correlations)
        card = _dataset_card(rows, matrix, min_n)
        (out / "dataset_card.md").write_text(card, encoding="utf-8")

        manifest = {
            "dataset_version": dataset.DATASET_VERSION,
            "generated_at": datetime.now(UTC).isoformat(),
            "min_n": min_n,
            "n_pairings": len(rows),
            "n_things": len(matrix.thing_ids),
            "n_scales": len(matrix.scale_ids),
            "n_bimodal": sum(1 for r in rows if r.is_bimodal),
            "files": [
                "embedding_matrix.csv", "pairings.csv", "histograms.csv",
                "scale_correlations.csv", "things.csv", "scales.csv",
                "dataset_card.md",
            ],
            "pii": "none (aggregate snapshots only)",
        }

        if options["parquet"]:
            self._write_parquet(out, rows, matrix)
            manifest["files"] += ["pairings.parquet", "embedding_matrix.parquet"]

        (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        self.stdout.write(
            self.style.SUCCESS(
                f"Exported {len(rows)} pairing(s) — {len(matrix.thing_ids)} things × "
                f"{len(matrix.scale_ids)} scales — to {out}/ (v{dataset.DATASET_VERSION})."
            )
        )

    # -- writers -----------------------------------------------------------

    def _write_pairings(self, path: Path, rows: list[dataset.PairingRow]) -> None:
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow([
                "pairing_id", "thing_id", "thing", "scale_id", "scale_left",
                "scale_right", "scale_label", "n", "median", "q25", "q75", "iqr",
                "std", "shape", "is_bimodal", "dip_ratio", "peaks",
                "ai_model", "ai_median", "ai_median_divergence", "ai_tv_distance",
            ])
            for r in rows:
                writer.writerow([
                    r.pairing_id, r.thing_id, r.thing, r.scale_id, r.scale_left,
                    r.scale_right, r.scale_label, r.n, _r(r.median), _r(r.q25),
                    _r(r.q75), _r(r.iqr), _r(r.std), r.shape, r.is_bimodal,
                    _r(r.dip_ratio), ";".join(_r(p) for p in r.peaks),
                    r.ai_model or "", _opt(r.ai_median),
                    _opt(r.ai_median_divergence), _opt(r.ai_tv_distance),
                ])

    def _write_histograms(self, path: Path, rows: list[dataset.PairingRow]) -> None:
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["pairing_id", *[f"b{i:02d}" for i in range(N_BUCKETS)]])
            for r in rows:
                writer.writerow([r.pairing_id, *[_r(x) for x in r.histogram]])

    def _write_matrix(self, path: Path, matrix: dataset.EmbeddingMatrix) -> None:
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["thing_id", "thing", *matrix.scale_labels])
            for i, tid in enumerate(matrix.thing_ids):
                cells = [
                    "" if np.isnan(v) else _r(v) for v in matrix.values[i]
                ]
                writer.writerow([tid, matrix.thing_labels[i], *cells])

    def _write_things(self, path: Path, matrix: dataset.EmbeddingMatrix) -> None:
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["thing_id", "thing"])
            for tid, label in zip(matrix.thing_ids, matrix.thing_labels, strict=True):
                writer.writerow([tid, label])

    def _write_scales(self, path: Path, matrix: dataset.EmbeddingMatrix) -> None:
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["scale_id", "scale_label"])
            for sid, label in zip(matrix.scale_ids, matrix.scale_labels, strict=True):
                writer.writerow([sid, label])

    def _write_correlations(
        self, path: Path, correlations: list[dataset.ScaleCorrelation]
    ) -> None:
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["scale_a", "scale_b", "r", "n_overlap"])
            for c in correlations:
                writer.writerow([c.scale_a, c.scale_b, _r(c.r), c.n_overlap])

    def _write_parquet(
        self, out: Path, rows: list[dataset.PairingRow], matrix: dataset.EmbeddingMatrix
    ) -> None:
        try:
            import pyarrow as pa
            import pyarrow.parquet as pq
        except ImportError as exc:  # optional dependency
            raise CommandError(
                "--parquet needs pyarrow: `uv add pyarrow` (or drop the flag "
                "to export CSV/JSON only)."
            ) from exc

        pairings = pa.table({
            "pairing_id": [r.pairing_id for r in rows],
            "thing": [r.thing for r in rows],
            "scale_label": [r.scale_label for r in rows],
            "n": [r.n for r in rows],
            "median": [r.median for r in rows],
            "iqr": [r.iqr for r in rows],
            "std": [r.std for r in rows],
            "is_bimodal": [r.is_bimodal for r in rows],
            "dip_ratio": [r.dip_ratio for r in rows],
            "ai_median_divergence": [r.ai_median_divergence for r in rows],
        })
        pq.write_table(pairings, out / "pairings.parquet")

        columns = {"thing_id": matrix.thing_ids, "thing": matrix.thing_labels}
        for j, label in enumerate(matrix.scale_labels):
            columns[label] = [
                None if np.isnan(v) else float(v) for v in matrix.values[:, j]
            ]
        pq.write_table(pa.table(columns), out / "embedding_matrix.parquet")


def _r(value: float) -> str:
    return f"{float(value):.4f}"


def _opt(value: float | None) -> str:
    return "" if value is None else _r(value)


def _dataset_card(
    rows: list[dataset.PairingRow], matrix: dataset.EmbeddingMatrix, min_n: int
) -> str:
    n_bimodal = sum(1 for r in rows if r.is_bimodal)
    n_ai = sum(1 for r in rows if r.ai_median is not None)
    return f"""# HiveScale crowd dataset (v{dataset.DATASET_VERSION})

Where a representative crowd places everyday **Things** on bipolar **Scales**
(0-100). The headline artifact, `embedding_matrix.csv`, is a Thing × Scale matrix
of crowd medians — a *named-dimension embedding* whose every axis is a
human-readable Scale.

## Contents
- `embedding_matrix.csv` — Things (rows) × Scales (columns); cell = crowd median.
- `pairings.csv` — per-pairing stats: median, q25/q75, IQR, std, shape,
  bimodality (dip ratio), and AI-vs-human divergence.
- `histograms.csv` — the full {N_BUCKETS}-bucket crowd distribution per pairing.
- `scale_correlations.csv` — Pearson r between Scales over shared Things.
- `things.csv`, `scales.csv` — dimension metadata.
- `manifest.json` — version, counts, and filters.

## Size
- Pairings: {len(rows)} (min {min_n} eligible answers each)
- Things: {len(matrix.thing_ids)} · Scales: {len(matrix.scale_ids)}
- Bimodal ("society at war"): {n_bimodal} · With an AI prior: {n_ai}

## How the values are made
Each cell is the weighted median of players' point estimates, from the same
snapshot the game scores against. Answers that are quality-flagged, faster than
the speed floor, or from zero-weighted players are excluded upstream, so only
trustworthy answers reach the aggregate.

## Privacy
Aggregate only. No player identifiers, device tokens, emails, timestamps, or
per-answer rows are exported — the dataset cannot be traced to an individual.

## Known biases & caveats
- **Sampling**: players are self-selected; Things/Scales are partly
  player-submitted, so coverage is uneven.
- **Culture & language**: placements are culture-specific; a `language` field
  exists on Things and baselines should be read per-language.
- **Sparsity**: not every Thing is rated on every Scale (blank matrix cells).
- **Provisional AI priors** live in `pairings.csv` for comparison only and never
  enter the crowd baseline.

## Licensing intent
Intended for open research release (e.g. CC-BY); confirm the consent copy shown
at account claim before redistribution.
"""
