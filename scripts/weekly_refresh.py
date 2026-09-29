"""Weekly refresh: download public data, update the injury ledger, rebuild projections and DST.

Runs unattended (GitHub Actions, .github/workflows/weekly-projections.yml) or locally:
    python scripts/weekly_refresh.py [--data-dir .cache/weekly] [--season 2026]

Steps:
 1. Download nflverse box scores (this and last season), schedule, PFR snap counts, player ids,
    injury reports, weekly rosters, and Sleeper's public player directory.
 2. Find the newest week whose games are all final. If the site already shows the next week,
    stop (nothing to do). The projection build itself rejects an incomplete week.
 3. Injury ledger (scripts/projections/injury-review.json), rolled to the new week:
      - reviewed IR placements carry forward while the player is inside his minimum stay;
      - players currently on IR / PUP / suspended in the roster-status feed are out this week;
      - one-week "Out" designations are never carried forward.
 4. prepare_availability.py -> build.py -> build_dst_snapshot.py, then fill any missing
    Sleeper ids from the Sleeper directory, and run the model tests.
With --early-next, once all but the last game or two of a week are played (Monday morning), next
week is also built from the games played so far and saved beside the site's snapshot
(src/data/rankings-next.json). The season-long pages read it, so waiver and trade advice counts
Sunday's games; the weekly pages stay on the week in progress until its last game is final. The
teams still to play are projected from the week before and listed in the file (pendingTeams).
With --refresh-current, when no new week is ready but the site's week is still being played,
that week is rebuilt with the latest betting lines and injury reports (daily Wed-Sun runs).
Betting lines that drop out of the schedule feed keep their last known value
(scripts/projections/lines-last-known.json), so a missing line never erases the adjustment.
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

import last_week

ROOT = Path(__file__).resolve().parents[1]
PROJ = ROOT / "scripts" / "projections"
SNAPSHOT = ROOT / "src" / "data" / "rankings-current.json"
NEXT = ROOT / "src" / "data" / "rankings-next.json"
# An early build waits until at most this many of the week's games are still to be played.
EARLY_PENDING_GAMES = 2
REVIEW = PROJ / "injury-review.json"
AVAILABILITY = PROJ / "availability-current.json"
LAST_LINES = PROJ / "lines-last-known.json"
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
        f"injuries_{season - 1}.csv": f"{NFLVERSE}/injuries/injuries_{season - 1}.csv",
        f"injuries_{season}.csv": f"{NFLVERSE}/injuries/injuries_{season}.csv",
        # Games served on injured reserve (Sleeper has no injury start date).
        f"roster_weekly_{season}.csv": f"{NFLVERSE}/weekly_rosters/roster_weekly_{season}.csv",
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


def keep_last_lines(data: Path, season: int, now: str) -> int:
    """Fill blank spread/total lines for this season from the last known values; remember new ones."""
    path = data / "games.csv"
    games = pd.read_csv(path, low_memory=False)
    memory = json.loads(LAST_LINES.read_text(encoding="utf-8")) if LAST_LINES.exists() else {}
    memory = {k: v for k, v in memory.items() if k.startswith(f"{season}_")}
    filled = 0
    for i in games.index[games.season.eq(season) & games.game_type.eq("REG")]:
        gid = games.at[i, "game_id"]
        spread, total = games.at[i, "spread_line"], games.at[i, "total_line"]
        if pd.notna(spread) and pd.notna(total):
            if memory.get(gid, {}).get("spread") != spread or memory.get(gid, {}).get("total") != total:
                memory[gid] = dict(spread=float(spread), total=float(total), seenAt=now)
        elif gid in memory and pd.isna(games.at[i, "result"]):
            games.at[i, "spread_line"], games.at[i, "total_line"] = memory[gid]["spread"], memory[gid]["total"]
            filled += 1
    LAST_LINES.write_text(json.dumps(dict(sorted(memory.items())), indent=1) + "\n", encoding="utf-8")
    if filled:
        games.to_csv(path, index=False)
    return filled


def fill_sleeper_ids(sleeper: dict, path: Path = SNAPSHOT):
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    by_gsis = {v.get("gsis_id"): k for k, v in sleeper.items() if v.get("gsis_id")}
    filled = 0
    for p in snapshot["players"]:
        if not p.get("sleeperId") and p["id"] in by_gsis:
            p["sleeperId"] = by_gsis[p["id"]]
            filled += 1
    snapshot["unmappedIdentityCount"] = sum(not p["sleeperId"] for p in snapshot["players"])
    path.write_text(json.dumps(snapshot, separators=(",", ":")), encoding="utf-8")
    return filled


def early_next(data: Path, season: int, fetched_at: str, games: pd.DataFrame, done: int):
    """Build next week from the games played so far, while this week's last games are pending."""
    week, snapshot = done + 1, json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    if snapshot["season"] != season or snapshot["week"] != week or week >= 18:
        print("Early build: the site is not on the week in progress; nothing to do.")
        return
    g = games[games.season.eq(season) & games.game_type.eq("REG") & games.week.eq(week)]
    played, pending = set(g[g.result.notna()].game_id), set(g[g.result.isna()].game_id)
    if not played or not pending or len(pending) > EARLY_PENDING_GAMES:
        print(f"Early build: Week {week} has {len(pending)} games still to play; nothing to do.")
        return
    stats = pd.read_csv(data / f"stats_player_week_{season}.csv", usecols=["week", "game_id"], low_memory=False)
    snaps = pd.read_parquet(data / f"snap_counts_{season}.parquet", columns=["week", "game_id", "game_type"])
    have_stats = set(stats[stats.week.eq(week)].game_id)
    have_snaps = set(snaps[snaps.game_type.eq("REG") & snaps.week.eq(week)].game_id)
    if played - have_stats or played - have_snaps:
        print(f"Early build: waiting for Week {week} box scores and snap counts "
              f"({len(played - have_stats)} games without stats, {len(played - have_snaps)} without snaps).")
        return
    target = week + 1
    print(f"Early build: Week {target} from Week {week} games played so far ({len(pending)} still to play).")
    sleeper = json.loads((data / "sleeper_players.json").read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc).isoformat()
    # The committed injury ledger and availability files belong to the week in progress: work on copies.
    review, availability = data / "early-injury-review.json", data / "early-availability.json"
    ledger = roll_ledger(json.loads(REVIEW.read_text(encoding="utf-8")), snapshot, sleeper, games, season, target, now)
    review.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
    staged = data / "snapshot-for-early-availability.json"
    staged.write_text(json.dumps({**snapshot, "week": target}), encoding="utf-8")
    run(PROJ / "prepare_availability.py", "--snapshot", staged, "--sleeper", data / "sleeper_players.json",
        "--injuries", data / f"injuries_{season}.csv", "--games", data / "games.csv", "--review", review,
        "--fetched-at", fetched_at, "--output", availability)
    run(PROJ / "build.py", "--data-dir", data, "--identities", SNAPSHOT, "--output", NEXT,
        "--season", season, "--week", target, "--availability", availability, "--early")
    fill_sleeper_ids(sleeper, NEXT)
    print(last_week.save(snapshot, json.loads(NEXT.read_text(encoding="utf-8"))["model"]))
    print(f"Early Week {target} projections saved.")


def run(*args):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run([sys.executable, *map(str, args)], check=True, cwd=ROOT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=ROOT / ".cache" / "weekly")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--skip-download", action="store_true", help="reuse files already in --data-dir")
    parser.add_argument("--week", type=int, help="rebuild this week even if the site already shows it")
    parser.add_argument("--refresh-current", action="store_true",
                        help="if no new week is ready, rebuild the week in progress with fresh lines and injuries")
    parser.add_argument("--allow-stale-snaps", action="store_true",
                        help="build even if last week's snap counts are not published yet (last retry of the week)")
    parser.add_argument("--early-next", action="store_true",
                        help="also build next week early once all but the week's last game or two are played")
    a = parser.parse_args()
    data = a.data_dir.resolve()
    fetched_at = datetime.now(timezone.utc).isoformat() if a.skip_download else fetch_inputs(data, a.season)
    if not a.skip_download:
        print(f"Kept last known betting lines for {keep_last_lines(data, a.season, fetched_at)} games.")
    games = pd.read_csv(data / "games.csv", low_memory=False)
    done = completed_week(games, a.season)
    refresh(a, data, fetched_at, games, done)
    if a.early_next and not a.week:
        early_next(data, a.season, fetched_at, games, done)


def refresh(a, data: Path, fetched_at: str, games: pd.DataFrame, done: int):
    target = a.week or done + 1
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    current = snapshot["season"] == a.season and snapshot["week"] == target
    if a.refresh_current and not a.week and current:
        print(f"Week {target} is in progress; rebuilding it with the latest lines and injury reports.")
        a.week = target
        a.allow_stale_snaps = True
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
    if snapshot["season"] == a.season and snapshot["week"] == target - 1:
        # A new week: keep last week's numbers so the site can show risers and fallers.
        print(last_week.save(snapshot, json.loads(SNAPSHOT.read_text(encoding="utf-8"))["model"]))
    print(f"Filled {fill_sleeper_ids(sleeper)} missing Sleeper ids.")
    run(ROOT / "scripts" / "build_dst_snapshot.py", "--data-dir", data, "--season", a.season, "--week", target)
    run("-m", "unittest", "discover", "-s", PROJ, "-p", "test_*.py")
    print(f"Week {target} projections and DST rebuilt.")


if __name__ == "__main__":
    main()
