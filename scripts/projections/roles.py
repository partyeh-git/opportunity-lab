"""Weekly role inputs from free nflverse data published during the season.

Snap share comes from PFR snap counts (nflverse `snap_counts`), matched to box-score player
ids through nflverse `players.csv`. Team plays per game = the most offensive snaps any player
on that team logged in the game (so a fast, high-volume offense raises every role estimate).
Role volume = snap share x team plays x the player's targets (or carries) per snap, so the
units match. No rankings, no play-by-play charting that is only published after the season.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

ROLE_POSITIONS = ('WR', 'TE', 'RB')


def read_roles(data_dir, years):
    ids = pd.read_csv(Path(data_dir)/'players.csv', usecols=['gsis_id', 'pfr_id'], low_memory=False).dropna()
    ids = ids.drop_duplicates('pfr_id')
    frames = []
    for year in years:
        path = Path(data_dir)/f'snap_counts_{year}.parquet'
        if not path.exists():
            raise FileNotFoundError(f'Missing snap counts: {path.name}')
        s = pd.read_parquet(path, columns=['game_id', 'season', 'game_type', 'week', 'pfr_player_id',
                                           'team', 'offense_snaps', 'offense_pct'])
        frames.append(s[s.game_type.eq('REG')])
    s = pd.concat(frames, ignore_index=True)
    s['team'] = s.team.replace({'LAR': 'LA', 'JAC': 'JAX', 'WSH': 'WAS'})
    s['team_plays'] = s.groupby(['game_id', 'team']).offense_snaps.transform('max')
    s = s.merge(ids, left_on='pfr_player_id', right_on='pfr_id', how='inner')
    s = s[s.offense_snaps.gt(0)].rename(columns={'gsis_id': 'player_id', 'offense_snaps': 'snaps', 'offense_pct': 'snap_share'})
    return s[['season', 'week', 'game_id', 'team', 'player_id', 'snaps', 'snap_share', 'team_plays']]


def position_rates(stats, roles, seasons):
    """League targets and carries per offensive snap by position, for shrinking player rates."""
    x = stats[stats.season.isin(seasons)].merge(roles, on=['season', 'week', 'player_id', 'team'])
    return {f'{pos} {key}': float(g[key].sum()/g.snaps.sum())
            for pos, g in x.groupby('position') if pos in ROLE_POSITIONS for key in ('targets', 'carries')}


def role_inputs(stats, roles, season, cutoff_week, rates, pseudo_snaps):
    """Per player: last-2-games volume and role volume (snap share x team plays x per-snap rate).

    Uses only games before the cutoff. Games the player missed are skipped, not counted as zero.
    """
    before = lambda f: f[(f.season < season) | (f.season.eq(season) & f.week.lt(cutoff_week))]
    s = before(stats[stats.position.isin(ROLE_POSITIONS)])
    games = s.merge(before(roles), on=['season', 'week', 'player_id', 'team'], how='inner')
    games = games.sort_values(['player_id', 'season', 'week'])
    plays = (before(roles)[lambda f: f.season.eq(season)].drop_duplicates(['game_id', 'team'])
             .groupby('team').team_plays.mean().to_dict())
    out = {}
    for pid, h in games.groupby('player_id', sort=False):
        this = h[h.season.eq(season)]
        if this.empty:
            continue
        team, pos = this.team.iloc[-1], this.position.iloc[-1]
        last2, last8 = this.tail(2), h.tail(8)
        share = float(last2.snap_share.mean())
        row = {}
        for key, team_volume in (('targets', plays.get(team)), ('carries', plays.get(team))):
            if team_volume is None or f'{pos} {key}' not in rates:
                continue
            rate = (last8[key].sum() + pseudo_snaps*rates[f'{pos} {key}'])/(last8.snaps.sum() + pseudo_snaps)
            row[key] = dict(last2=float(last2[key].mean()), role=float(share*team_volume*rate))
        if row:
            out[pid] = dict(position=pos, team=team, snapShareLast2=share, **row)
    return out


def blend(model_volume, inputs, weights):
    """Learned blend of the model's volume, the last 2 games, and the role estimate."""
    w = weights
    return max(0., w[0]*model_volume + w[1]*inputs['last2'] + w[2]*inputs['role'])
