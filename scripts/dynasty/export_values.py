"""Turn the dynasty model's CSV into the small JSON file the Dynasty board reads.

Usage: python3 scripts/dynasty/export_values.py <dynasty_values.csv> <league_id> [development_scores.csv] [pick_factors.csv]
Writes public/dynasty-values.json. The model itself lives outside this repo (Drive research
folder); this only reshapes its output.
"""

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PLANS = ("win_now", "balanced", "rebuild")


def num(value: str) -> float:
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    source, league_id = Path(sys.argv[1]), sys.argv[2]
    rows = list(csv.DictReader(source.open()))
    # Development score: a guide for young players only; it never changes the value.
    dev = {}
    if len(sys.argv) > 3:
        for d in csv.DictReader(Path(sys.argv[3]).open()):
            if d["dev_score"]:
                dev[d["sleeper_id"]] = (round(float(d["dev_score"])), d["trend"] or "flat")
    # Pick factors: projected draft slot (from current standings) scales a pick's value.
    factors = {}
    if len(sys.argv) > 4:
        for f in csv.DictReader(Path(sys.argv[4]).open()):
            factors[f["pick_id"]] = (float(f["factor"]), f["slot"] or None)
    years = sorted(
        int(col.split("_")[1]) for col in rows[0] if col.startswith("vorp_") and col[5:].isdigit()
    )
    players = []
    for row in rows:
        factor, slot = factors.get(row["sleeper_id"], (1.0, None))
        totals = {plan: round(num(row[f"total_{plan}"]) * factor, 1) for plan in PLANS}
        if max(totals.values()) <= 0:
            continue
        is_pick = row["position"] == "PICK"
        players.append(
            {
                "id": row["sleeper_id"],
                "name": row["name"],
                "pos": row["position"],
                "team": row["team"] or None,
                "age": num(row["age"]) if row["age"] else None,
                # Picks keep the model's owner; players get theirs live from the Sleeper rosters.
                "pickOwner": row["owner"] if is_pick else None,
                "byYear": [
                    round(num(v) * factor, 1)
                    for v in [row["ros_2026"]] + [row[f"vorp_{y}"] for y in years]
                ],
                "slot": slot,
                "totals": totals,
                # Risk: Balanced-total range across similar past players, plus bust chance.
                "risk": row.get("risk_label") or None,
                "range": [num(row["bal_p10"]), num(row["bal_p50"]), num(row["bal_p90"])]
                if row.get("bal_p50")
                else None,
                "bust": round(float(row["bust_chance"]) * 100) if row.get("bust_chance") else None,
                "dev": dev[row["sleeper_id"]][0] if row["sleeper_id"] in dev else None,
                "devTrend": dev[row["sleeper_id"]][1] if row["sleeper_id"] in dev else None,
            }
        )
    out = {
        "leagueId": league_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "years": ["2026 rest"] + [str(y) for y in years],
        "planWeights": {
            "win_now": "This season 100%, then each later season 60% of the one before",
            "balanced": "This season 100%, then each later season 85% of the one before",
            "rebuild": "This season 10%, then each later season 95% of the one before",
        },
        "players": players,
    }
    target = Path(__file__).resolve().parents[2] / "public" / "dynasty-values.json"
    target.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(players)} entries -> {target}")


if __name__ == "__main__":
    main()
