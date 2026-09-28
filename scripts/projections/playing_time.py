"""Minimal-playing-time rule (all positions): games cut short by injury never inform the model.

A game is PARTIAL when the player's offensive snap share was under half of his usual share
(median of his previous 8 appearances, at least 2 needed) AND there is an injury sign: he
missed his team's next game, or he is on the official injury report for that next game.
Low-snap games without an injury sign are kept, because they are real roles (backups,
demotions, kneel-downs). Missed games are skipped everywhere, never counted as zeros.

Only pregame information is used: the "missed next game" test needs that game to be before
the forecast week; the injury report for the forecast week itself is published before kickoff.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

LOW_SHARE_RATIO = 0.5
TYPICAL_GAMES = 8


def read_injury_reports(data_dir, years):
    frames = []
    for year in years:
        path = Path(data_dir)/f'injuries_{year}.csv'
        if path.exists():
            f = pd.read_csv(path, usecols=['season', 'game_type', 'week', 'gsis_id', 'report_status'], low_memory=False)
            frames.append(f[f.game_type.eq('REG') & f.report_status.notna()])
    if not frames:
        return set()
    f = pd.concat(frames)
    return set(zip(f.season.astype(int), f.week.astype(int), f.gsis_id))


def flag_games(stats, roles, schedule, reports):
    """Per player-game: is it a low-share game, and the facts needed to call it partial at a cutoff.

    Returns stats with columns: snap_share, low_share, next_week, played_next, reported_next.
    """
    s = stats.merge(roles[['season', 'week', 'player_id', 'snap_share']].drop_duplicates(['season', 'week', 'player_id']),
                    on=['season', 'week', 'player_id'], how='left')
    s = s.sort_values(['player_id', 'season', 'week'])
    # Usual share: median of the previous appearances with snap data (past-only).
    typical = (s.groupby('player_id').snap_share
               .transform(lambda x: x.shift(1).rolling(TYPICAL_GAMES, min_periods=2).median()))
    s['low_share'] = (s.snap_share < LOW_SHARE_RATIO*typical).fillna(False)
    # Team's next game after this one (same season).
    sched = schedule[['season', 'week', 'team']].drop_duplicates().sort_values(['season', 'team', 'week'])
    sched['next_week'] = sched.groupby(['season', 'team']).week.shift(-1)
    s = s.merge(sched, on=['season', 'week', 'team'], how='left')
    appeared = set(zip(stats.season, stats.week, stats.player_id))
    appeared |= set(zip(roles.season, roles.week, roles.player_id))
    nxt = s.next_week.fillna(-1).astype(int)
    s['played_next'] = [(a, b, c) in appeared for a, b, c in zip(s.season, nxt, s.player_id)]
    s['reported_next'] = [(a, b, c) in reports for a, b, c in zip(s.season, nxt, s.player_id)]
    s.attrs['reports'] = reports  # (season, week, player) on each week's injury report
    return s


def partial_mask(flagged, season, cutoff_week):
    """Games to exclude when forecasting (season, cutoff_week), using only what is known by then."""
    f = flagged
    before_cutoff = (f.season < season) | (f.next_week < cutoff_week)
    known_missed = f.next_week.notna() & before_cutoff & ~f.played_next
    # Next game's injury report is known if that game is at or before the forecast week.
    report_known = (f.season < season) | (f.next_week <= cutoff_week)
    reported = f.next_week.notna() & report_known & f.reported_next
    return f.low_share & (known_missed | reported)


def partial_keys(flagged, season, cutoff_week):
    m = partial_mask(flagged, season, cutoff_week)
    x = flagged[m]
    return set(zip(x.season.astype(int), x.week.astype(int), x.player_id))


def read_unavailable(data_dir, years):
    """Historical pregame 'will not play' sets per (season, week): not on the active/inactive roster
    (IR, cut, retired, practice squad) or ruled Out on the injury report. Mirrors live Sleeper IR/Out."""
    out = {}
    for year in years:
        r = pd.read_csv(Path(data_dir)/f'roster_weekly_{year}.csv', usecols=['season', 'week', 'gsis_id', 'status', 'game_type'], low_memory=False)
        r = r[r.game_type.eq('REG') & ~r.status.isin(['ACT', 'INA'])]
        for (s, w), g in r.groupby(['season', 'week']):
            out.setdefault((int(s), int(w)), set()).update(g.gsis_id)
        path = Path(data_dir)/f'injuries_{year}.csv'
        if path.exists():
            i = pd.read_csv(path, usecols=['season', 'week', 'gsis_id', 'report_status', 'game_type'], low_memory=False)
            i = i[i.game_type.eq('REG') & i.report_status.eq('Out')]
            for (s, w), g in i.groupby(['season', 'week']):
                out.setdefault((int(s), int(w)), set()).update(g.gsis_id)
    return out


TEAM_FIX = {'LAR': 'LA', 'JAC': 'JAX', 'WSH': 'WAS'}


def read_qb1(data_dir, years, games=None):
    """Depth-chart starting QB per (season, week) -> {team: gsis_id}. Pregame team depth charts.

    2023-24 files are weekly. 2025+ files are dated snapshots; for live use we take the latest
    snapshot and file it under key (season, None).
    """
    out = {}
    for year in years:
        path = Path(data_dir)/f'depth_charts_{year}.csv'
        if not path.exists():
            continue
        head = pd.read_csv(path, nrows=1)
        if 'depth_team' in head.columns:
            d = pd.read_csv(path, usecols=['season', 'club_code', 'week', 'game_type', 'depth_team', 'gsis_id', 'depth_position'], low_memory=False)
            d = d[d.game_type.eq('REG') & d.depth_position.eq('QB') & d.depth_team.astype(str).eq('1')].dropna(subset=['week'])
            for r in d.itertuples():
                out.setdefault((int(r.season), int(r.week)), {})[TEAM_FIX.get(r.club_code, r.club_code)] = r.gsis_id
        else:
            d = pd.read_csv(path, usecols=['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank'], low_memory=False)
            d = d[d.pos_abb.eq('QB') & d.pos_rank.eq(1)]
            latest = d[d.dt.eq(d.dt.max())]
            out[(year, None)] = {TEAM_FIX.get(t, t): g for t, g in zip(latest.team, latest.gsis_id)}
            if games is not None:
                # Historical weeks: the last snapshot taken before that week's first game day.
                g = games[games.season.eq(year) & games.game_type.eq('REG')]
                for week, first_day in g.groupby('week').gameday.min().items():
                    snap = d[d.dt < str(first_day)]
                    if len(snap):
                        snap = snap[snap.dt.eq(snap.dt.max())]
                        out[(year, int(week))] = {TEAM_FIX.get(t, t): x for t, x in zip(snap.team, snap.gsis_id)}
    return out
