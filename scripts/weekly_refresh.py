"""Weekly refresh: download public data, update the injury ledger, rebuild projections and DST.

Runs unattended (GitHub Actions, .github/workflows/weekly-projections.yml) or locally:
    python scripts/weekly_refresh.py [--data-dir .cache/weekly] [--season 2026]

Steps:
 1. Download nflverse box scores (this and last season), schedule, PFR snap counts, player ids,
    injury reports, and Sleeper's public player directory.
 2. Find the newest week whose games are all final. If the site already shows the next week,
    stop (nothing to do). The projection build itself rejects an incomplete week.
 3. Injury ledger (scripts/projections/injury-review.json), rolled to the new week:
      - reviewed IR placements carry forward while the player is inside his minimum stay;
      - players currently on IR / PUP / suspended in the roster-status feed are out this week;
      - one-week "Out" designations are never carried forward.
 4. prepare_availability.py -> build.py -> build_dst_snapshot.py, then fill any missing
    Sleeper ids from the Sleeper directory, and run the model tests.
No fantasy rankings are read. The locked 2025 season is used only as last season's inputs.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PROJ = ROOT / "scripts" / "projections"
SNAPSHOT = ROOT / "src" / "data" / "rankings-current.json"
REVIEW = PROJ / "injury-review.json"
AVAILABILITY = PROJ / "availability-current.json"
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
ROSTER_OUT = {"IR": "injured reserve", "PUP": "physically unable to perform list", "Sus": "suspension"}


def download(url: str, path: Path):
    request = urllib.request.Request(url, headers={"User-Agent": "fantasy-hq-weekly-refresh"})
    with urllib.request.urlopen(request, timeout=120) as response:
        path.write_bytes(response.read())


def fetch_inputs(data: Path, season: int) -> str:
    data.mkdir(parents=True, exist_ok=True)
    files = {
        f"stats_player_week_{season - 1}.csv": f"{NFLVERSE}/stats_player/stats_player_week_{season - 1}.csv",
        f"stats_player_week_{season}.csv": f"{NFLVERSE}/stats_player/stats_player_week_{season}.csv",
        "games.csv": f"{NFLVERSE}/schedules/games.csv",
        f"snap_counts_{season - 1}.parquet": f"{NFLVERSE}/snap_counts/snap_counts_{season - 1}.parquet",
        f"snap_counts_{season}.parquet": f"{NFLVERSE}/snap_counts/snap_counts_{season}.parquet",
        "players.csv": f"{NFLVERSE}/players/players.csv",
        f"injuries_{season}.csv": f"{NFLVERSE}/injuries/injuries_{season}.csv",
    }
    for name, url in files.items():
        download(url, data / name)
    fetched_at = datetime.now(timezone.utc).isoformat()
    download("https://api.sleeper.app/v1/players/nfl", data / "sleeper_players.json")
    return fetched_at


def completed_week(games: pd.DataFrame, season: int) -> int:
    g = games[games.season.eq(season) & games.game_type.eq("REG")]
    done = g.groupby("week").apply(lambda x: x.result.notna().all(), include_groups=False)
    finished = [int(w) for w, ok in done.items() if ok]
    week = 0
    while week + 1 in finished:
        week += 1
    return week


def roll_ledger(old: dict, snapshot: dict, sleeper: dict, games: pd.DataFrame, season: int, week: int, now: str) -> dict:
    sys.path.insert(0, str(PROJ))
    from model import schedule_rows  # noqa: E402

    fixtures = schedule_rows(games)
    players = {p["id"]: p for p in snapshot["players"]}
    kept = []
    for r in old.get("records", []):
        p = players.get(r["id"])
        if not p or p["team"] != r["team"] or r.get("sourceKind") == "roster_status":
            continue  # traded/released, or last week's roster-status entry (re-derived below)
        if "minimumMissedGames" in r:
            games_left = fixtures[fixtures.season.eq(season) & fixtures.team.eq(r["team"]) & fixtures.week.ge(r["firstMissedWeek"])]
            out = games_left.sort_values("week").head(r["minimumMissedGames"]).week.astype(int).tolist()
        else:
            out = r.get("outWeeks", [])
        if out and max(out) >= week:
            kept.append(r)
    have = {r["id"] for r in kept}
    today = now[:10]
    for p in snapshot["players"]:
        s = sleeper.get(p.get("sleeperId") or "", {})
        status = s.get("injury_status")
        team = {"LAR": "LA", "JAC": "JAX"}.get(s.get("team"), s.get("team"))
        if p["id"] in have or status not in ROSTER_OUT or team != p["team"] or s.get("position") != p["position"]:
            continue
        kept.append(dict(
            id=p["id"], team=p["team"], reportedStatus=status, injury=s.get("injury_body_part") or "",
            outWeeks=[week], publishedDate=today, sourceKind="roster_status",
            sourceUrl="https://api.sleeper.app/v1/players/nfl",
            sourceTitle=f"NFL roster status via Sleeper: {ROSTER_OUT[status]}",
            note="On a list he cannot play from this week. Return date not confirmed; later weeks assume he plays."))
    return dict(season=season, week=week, reviewedAt=now, records=kept,
                note="Rolled automatically by scripts/weekly_refresh.py; reviewed IR entries carried inside their minimum stay.")


def fill_sleeper_ids(sleeper: dict):
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    by_gsis = {v.get("gsis_id"): k for k, v in sleeper.items() if v.get("gsis_id")}
    filled = 0
    for p in snapshot["players"]:
        if not p.get("sleeperId") and p["id"] in by_gsis:
            p["sleeperId"] = by_gsis[p["id"]]
            filled += 1
    snapshot["unmappedIdentityCount"] = sum(not p["sleeperId"] for p in snapshot["players"])
    SNAPSHOT.write_text(json.dumps(snapshot, separators=(",", ":")), encoding="utf-8")
    return filled


def run(*args):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run([sys.executable, *map(str, args)], check=True, cwd=ROOT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=ROOT / ".cache" / "weekly")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--skip-download", action="store_true", help="reuse files already in --data-dir")
    parser.add_argument("--week", type=int, help="rebuild this week even if the site already shows it")
    parser.add_argument("--allow-stale-snaps", action="store_true",
                        help="build even if last week's snap counts are not published yet (last retry of the week)")
    a = parser.parse_args()
    data = a.data_dir.resolve()
    fetched_at = datetime.now(timezone.utc).isoformat() if a.skip_download else fetch_inputs(data, a.season)
    games = pd.read_csv(data / "games.csv", low_memory=False)
    done = completed_week(games, a.season)
    target = a.week or done + 1
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    if target > done + 1:
        raise SystemExit(f"Week {target - 1} games are not all final yet.")
    if target > 18:
        print("Regular season complete; nothing to rebuild.")
        return
    if not a.week and snapshot["season"] == a.season and snapshot["week"] >= target:
        print(f"Site already shows Week {snapshot['week']}; latest final week is {done}. Nothing to do.")
        return
    snaps = pd.read_parquet(data / f"snap_counts_{a.season}.parquet", columns=["week", "game_type"])
    snap_week = int(snaps[snaps.game_type.eq("REG")].week.max())
    if snap_week < target - 1:
        if not a.allow_stale_snaps:
            print(f"Snap counts only reach Week {snap_week}; waiting for Week {target - 1} before rebuilding.")
            return
        print(f"Warning: snap counts only reach Week {snap_week}; building with older snap shares.")
    print(f"Rebuilding for Week {target} (games final through Week {done}).")
    sleeper = json.loads((data / "sleeper_players.json").read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc).isoformat()
    ledger = roll_ledger(json.loads(REVIEW.read_text(encoding="utf-8")), snapshot, sleeper, games, a.season, target, now)
    REVIEW.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
    # prepare_availability reads season/week and the player list from a snapshot of the new week.
    staged = data / "snapshot-for-availability.json"
    staged.write_text(json.dumps({**snapshot, "week": target}), encoding="utf-8")
    run(PROJ / "prepare_availability.py", "--snapshot", staged, "--sleeper", data / "sleeper_players.json",
        "--injuries", data / f"injuries_{a.season}.csv", "--games", data / "games.csv", "--review", REVIEW,
        "--fetched-at", fetched_at, "--output", AVAILABILITY)
    run(PROJ / "build.py", "--data-dir", data, "--identities", SNAPSHOT, "--output", SNAPSHOT,
        "--season", a.season, "--week", target, "--availability", AVAILABILITY)
    print(f"Filled {fill_sleeper_ids(sleeper)} missing Sleeper ids.")
    run(ROOT / "scripts" / "build_dst_snapshot.py", "--data-dir", data, "--season", a.season, "--week", target)
    run("-m", "unittest", "discover", "-s", PROJ, "-p", "test_*.py")
    print(f"Week {target} projections and DST rebuilt.")


if __name__ == "__main__":
    main()
