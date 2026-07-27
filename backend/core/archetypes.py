"""Calibration archetypes (WP-11, plan §2.2).

A player's long-term interval behaviour is framed as an identity — Oracle,
Maverick, Diplomat — derived from their running calibration stats. Names,
blurbs, and thresholds live in ``data/archetypes.json`` (config, not code) so
they can be tuned without a deploy; rules are evaluated in order, first match
wins, and everyone below ``min_rounds`` is the default.
"""

import functools
import json
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent / "data" / "archetypes.json"


@functools.lru_cache(maxsize=1)
def _config() -> dict:
    return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))


def calibration_summary(stats: dict) -> dict:
    """Derive (n, hit_rate, mean_width) from a player's raw calibration counters."""
    n = int(stats.get("n", 0))
    hits = int(stats.get("hits", 0))
    total_width = float(stats.get("total_width", 0.0))
    return {
        "n": n,
        "hit_rate": hits / n if n else 0.0,
        "mean_width": total_width / n if n else 0.0,
    }


def _matches(rule: dict, hit_rate: float, mean_width: float) -> bool:
    if hit_rate < rule.get("min_hit_rate", float("-inf")):
        return False
    if hit_rate > rule.get("max_hit_rate", float("inf")):
        return False
    if mean_width < rule.get("min_mean_width", float("-inf")):
        return False
    if mean_width > rule.get("max_mean_width", float("inf")):
        return False
    return True


def classify(stats: dict) -> dict:
    """Return ``{"name", "blurb"}`` for a player's calibration stats."""
    config = _config()
    summary = calibration_summary(stats)
    if summary["n"] < config["min_rounds"]:
        return config["default"]
    for rule in config["rules"]:
        if _matches(rule, summary["hit_rate"], summary["mean_width"]):
            return {"name": rule["name"], "blurb": rule["blurb"]}
    return config["default"]
