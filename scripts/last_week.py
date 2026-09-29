#!/usr/bin/env python3
"""Keep a small copy of last week's projections so the site can show who is rising or falling.

public/last-week.json holds each player's projected points for every week still to be played,
as they stood before the new week's rebuild. The site compares the same future weeks in both
files, and only when both came from the same model version (a model change moves everyone and
would look like a wave of risers and fallers).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAST_WEEK = ROOT / "public" / "last-week.json"


def compact(snapshot: dict) -> dict:
    """The snapshot's forecasts for weeks after its own, in full and half PPR."""
    players = {}
    for p in snapshot["players"]:
        games = [g for g in p["weeklyForecasts"] if g["week"] > snapshot["week"]]
        if games:
            players[p["id"]] = {
                "weeks": [g["week"] for g in games],
                "full": [round(g["full"], 1) for g in games],
                "half": [round(g["half"], 1) for g in games],
            }
    return {
        "season": snapshot["season"],
        "week": snapshot["week"],
        "model": snapshot["model"],
        "generatedAt": snapshot["generatedAt"],
        "players": players,
    }


def save(old: dict, new_model: str, path: Path = LAST_WEEK) -> str:
    """Save `old` as last week's copy, unless a same-model copy of that week is already there."""
    if old["model"] != new_model and path.exists():
        kept = json.loads(path.read_text(encoding="utf-8"))
        if (kept.get("season"), kept.get("week"), kept.get("model")) == (old["season"], old["week"], new_model):
            return f"Kept the existing Week {old['week']} copy built on {new_model}."
    path.write_text(json.dumps(compact(old), separators=(",", ":")) + "\n", encoding="utf-8")
    return f"Saved Week {old['week']} projections ({old['model']}) as last week's copy."


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=LAST_WEEK)
    a = parser.parse_args()
    snapshot = json.loads(a.snapshot.read_text(encoding="utf-8"))
    print(save(snapshot, snapshot["model"], a.output))
