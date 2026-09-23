"""Pregame DST streaming snapshot from nflverse team-game data, without fantasy rankings.

Run with --data-dir pointing at downloaded nflverse stats_player_week_YYYY.csv and
games.csv. The season/week cutoff is applied before all feature aggregation.
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

EVENTS = [
    'def_sacks', 'def_interceptions', 'def_fumbles_forced', 'fumble_recovery_opp',
    'def_tds', 'special_teams_tds', 'def_safeties', 'def_punt_blocks',
    'def_pat_blocks', 'def_fg_blocks', 'sacks_suffered',
    'passing_interceptions', 'fumbles_lost_total', 'passing_yards',
    'rushing_yards', 'sack_yards_lost',
]
POINT_BINS = [
    ('pts_allow_0', -math.inf, .5), ('pts_allow_1_6', .5, 6.5),
    ('pts_allow_7_13', 6.5, 13.5), ('pts_allow_14_20', 13.5, 20.5),
    ('pts_allow_21_27', 20.5, 27.5), ('pts_allow_28_34', 27.5, 34.5),
    ('pts_allow_35p', 34.5, math.inf),
]
YARD_BINS = [
    ('yds_allow_0_100', -math.inf, 100), ('yds_allow_100_199', 100, 200),
    ('yds_allow_200_299', 200, 300), ('yds_allow_300_349', 300, 350),
    ('yds_allow_350_399', 350, 400), ('yds_allow_400_449', 400, 450),
    ('yds_allow_450_499', 450, 500), ('yds_allow_500_549', 500, 550),
    ('yds_allow_550p', 550, math.inf),
]
RATE_KEYS = ['sacks', 'picks', 'forced', 'recoveries', 'def_tds', 'st_tds',
             'safeties', 'blocks', 'sacks_allowed', 'picks_thrown',
             'fumbles_lost', 'points_for', 'points_allowed',
             'yards_for', 'yards_allowed']


def normal_cdf(x, mean, sigma):
    if x == -math.inf:
        return 0.0
    if x == math.inf:
        return 1.0
    return .5 * (1 + math.erf((x - mean) / (sigma * math.sqrt(2))))


def probabilities(mean, sigma, bins):
    return {name: round(normal_cdf(upper, mean, sigma) - normal_cdf(lower, mean, sigma), 5)
            for name, lower, upper in bins}


def load_games(data_dir, seasons):
    pieces = []
    for season in seasons:
        frame = pd.read_csv(data_dir / f'stats_player_week_{season}.csv', low_memory=False)
        frame = frame[frame.season_type.eq('REG')]
        missing = set(EVENTS) - set(frame.columns)
        if missing:
            raise ValueError(f'Missing nflverse fields: {missing}')
        frame[EVENTS] = frame[EVENTS].apply(pd.to_numeric, errors='raise').fillna(0.0)
        pieces.append(frame[['season', 'week', 'game_id', 'team', *EVENTS]])
    stats = pd.concat(pieces).groupby(['season', 'week', 'game_id', 'team'], as_index=False)[EVENTS].sum()
    games = pd.read_csv(data_dir / 'games.csv', low_memory=False)
    games = games[games.season.isin(seasons) & games.game_type.eq('REG')]
    if games.duplicated(['season', 'week', 'game_id']).any():
        raise ValueError('Duplicate games')
    index = stats.set_index(['season', 'week', 'game_id', 'team'])
    rows = []
    for game in games.itertuples():
        for team, opponent, pf, pa in [(game.home_team, game.away_team, game.home_score, game.away_score),
                                      (game.away_team, game.home_team, game.away_score, game.home_score)]:
            key = (game.season, game.week, game.game_id, team)
            opponent_key = (game.season, game.week, game.game_id, opponent)
            if key not in index.index or opponent_key not in index.index or pd.isna(pf) or pd.isna(pa):
                continue
            own, other = index.loc[key], index.loc[opponent_key]
            yards = lambda s: max(0., float(s.passing_yards + s.rushing_yards + s.sack_yards_lost))
            rows.append(dict(season=int(game.season), week=int(game.week), team=team, opponent=opponent,
                             sacks=float(own.def_sacks), picks=float(own.def_interceptions),
                             forced=float(own.def_fumbles_forced), recoveries=float(own.fumble_recovery_opp),
                             def_tds=float(own.def_tds), st_tds=float(own.special_teams_tds),
                             safeties=float(own.def_safeties),
                             blocks=float(own.def_punt_blocks + own.def_pat_blocks + own.def_fg_blocks),
                             sacks_allowed=float(own.sacks_suffered),
                             picks_thrown=float(own.passing_interceptions),
                             fumbles_lost=float(own.fumbles_lost_total),
                             points_for=float(pf), points_allowed=float(pa),
                             yards_for=yards(own), yards_allowed=yards(other)))
    return pd.DataFrame(rows), games


def project(history, season, week, team, opponent):
    prior = history[history.season.eq(season - 1)]
    current = history[history.season.eq(season) & history.week.lt(week)]
    if prior.empty:
        raise ValueError('Complete prior season is required for DST projections')
    league_mean = prior[RATE_KEYS].mean()

    def smoothed(target, metric):
        prev = prior[prior.team.eq(target)][metric]
        recent = current[current.team.eq(target)].sort_values('week')[metric].tail(4)
        prev_rate = (prev.sum() + 8 * league_mean[metric]) / (len(prev) + 8)
        return float((recent.sum() + 4 * prev_rate) / (len(recent) + 4))

    # Weekly streaming is opponent-led: 65% offense vulnerability, 35% defense ability.
    mean = lambda defense_metric, offense_metric: .35 * smoothed(team, defense_metric) + .65 * smoothed(opponent, offense_metric)
    pa = mean('points_allowed', 'points_for')
    ya = mean('yards_allowed', 'yards_for')
    return dict(team=team, opponent=opponent,
                sacks=round(mean('sacks', 'sacks_allowed'), 3),
                interceptions=round(mean('picks', 'picks_thrown'), 3),
                forcedFumbles=round(mean('forced', 'fumbles_lost'), 3),
                fumbleRecoveries=round(mean('recoveries', 'fumbles_lost'), 3),
                defensiveTds=round(.4 * smoothed(team, 'def_tds') + .6 * league_mean.def_tds, 3),
                specialTeamsTds=round(.4 * smoothed(team, 'st_tds') + .6 * league_mean.st_tds, 3),
                safeties=round(.4 * smoothed(team, 'safeties') + .6 * league_mean.safeties, 3),
                blockedKicks=round(.4 * smoothed(team, 'blocks') + .6 * league_mean.blocks, 3),
                expectedPointsAllowed=round(pa, 1), expectedYardsAllowed=round(ya, 1),
                pointsAllowedBuckets=probabilities(pa, 10, POINT_BINS),
                yardsAllowedBuckets=probabilities(ya, 90, YARD_BINS))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--season', type=int, default=2026)
    parser.add_argument('--week', type=int, default=3)
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1] / 'src/data/dst-current.json')
    args = parser.parse_args()
    history, games = load_games(args.data_dir, [args.season - 1, args.season])
    target = games[games.season.eq(args.season) & games.week.eq(args.week)]
    if not len(target):
        raise ValueError(f'No Week {args.week} NFL games found')
    completed = history[history.season.eq(args.season) & history.week.eq(args.week - 1)]
    expected = games[games.season.eq(args.season) & games.week.eq(args.week - 1)]
    if len(completed) != 2 * len(expected):
        raise ValueError(f'Week {args.week - 1} data is incomplete')
    entries = []
    for game in target.itertuples():
        entries.extend([project(history, args.season, args.week, game.home_team, game.away_team),
                        project(history, args.season, args.week, game.away_team, game.home_team)])
    payload = dict(season=args.season, week=args.week, dataThroughWeek=args.week - 1,
                   generatedAt=datetime.now(timezone.utc).isoformat(),
                   formula='Opponent-led streaming: 65% opposing-offense vulnerability and 35% defense ability for sacks, turnovers, points and yards. Prior-season team and league rates blend with pregame current-season rates using four current-game and eight prior-season pseudo-game shrinkage. Scoring buckets integrate normal predictive distributions (10 points, 90 yards SD).',
                   defenses=sorted(entries, key=lambda x: x['team']))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {len(entries)} Week {args.week} DST matchups to {args.out}')


if __name__ == '__main__':
    main()
