"""Export the scored rookie class to public/rookie-board-<year>.json for the Dynasty tab.

Usage: python scripts/dynasty/export_rookies.py <rookie_scores_YYYY.csv> <year> [league_id]
The CSV comes from the development-model scoring run (reports/rookie_scores_YYYY.csv in the Drive hub).
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

src, year = sys.argv[1], sys.argv[2]
league_id = sys.argv[3] if len(sys.argv) > 3 else "1349017262316601344"
d = pd.read_csv(src).sort_values("rookie_rank")


def slug(name: str, pos: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", f"{name} {pos}".lower()).strip("-")


def num(v, nd=0):
    return None if pd.isna(v) else (round(float(v), nd) if nd else int(round(float(v))))


players = []
for r in d.itertuples():
    flag = None
    if bool(r.no_board):
        flag = "On no NFL draft board yet (may stay in school). Draft slot is a guess."
    elif bool(r.dt_missing):
        flag = "Missing from the deep DraftTek board (may stay in school). Slot from Walter only."
    players.append(
        {
            "id": slug(r.name, r.pos),
            "rank": int(r.rookie_rank),
            "tier": num(r.tier),
            "name": r.name,
            "pos": r.pos,
            "posRank": int(r.pos_rank),
            "college": r.college,
            "projPick": num(r.proj_pick),
            "value": num(r.exp_vorp3),
            "hit": num(r.hit_rate),
            "dev": num(r.dev_score),
            "age": num(r.draft_age, 1),
            "flag": flag,
        }
    )

out = {
    "leagueId": league_id,
    "classYear": year,
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "players": players,
}
path = Path(__file__).resolve().parents[2] / "public" / f"rookie-board-{year}.json"
path.write_text(json.dumps(out, indent=1))
print(f"wrote {path} ({len(players)} players)")
