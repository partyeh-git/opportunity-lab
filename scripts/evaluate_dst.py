"""Historical pregame check for the fixed DST streaming formula."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from build_dst_snapshot import POINT_BINS, YARD_BINS, load_games, project


def projected_score(p):
    return (p['sacks'] + 2 * p['interceptions'] + p['forcedFumbles']
            + 2 * p['fumbleRecoveries'] + 6 * (p['defensiveTds'] + p['specialTeamsTds'])
            + 2 * (p['safeties'] + p['blockedKicks'])
            + sum(v * {'pts_allow_0': 10, 'pts_allow_1_6': 7, 'pts_allow_7_13': 4,
                       'pts_allow_14_20': 1, 'pts_allow_21_27': 0,
                       'pts_allow_28_34': -1, 'pts_allow_35p': -4}[k]
                  for k, v in p['pointsAllowedBuckets'].items()))


def actual_score(row):
    points_bucket = next(k for k, lo, hi in POINT_BINS if lo <= row.points_allowed < hi)
    point_weights = {'pts_allow_0': 10, 'pts_allow_1_6': 7, 'pts_allow_7_13': 4,
                     'pts_allow_14_20': 1, 'pts_allow_21_27': 0,
                     'pts_allow_28_34': -1, 'pts_allow_35p': -4}
    return (row.sacks + 2 * row.picks + row.forced + 2 * row.recoveries
            + 6 * (row.def_tds + row.st_tds) + 2 * (row.safeties + row.blocks)
            + point_weights[points_bucket])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    results = {}
    for season in (2024, 2025):
        history, games = load_games(args.data_dir, [season - 1, season])
        weekly = []
        for week in range(5, 19):
            actuals = history[history.season.eq(season) & history.week.eq(week)]
            if len(actuals) < 24:
                continue
            rows = []
            for row in actuals.itertuples():
                pred = project(history, season, week, row.team, row.opponent)
                rows.append((row.team, projected_score(pred), actual_score(row)))
            predicted = np.asarray([r[1] for r in rows])
            actual = np.asarray([r[2] for r in rows])
            predicted_order = np.sign(predicted[:, None] - predicted[None, :])
            actual_order = np.sign(actual[:, None] - actual[None, :])
            comparable = np.triu((predicted_order != 0) & (actual_order != 0), 1)
            weekly.append(dict(week=week, n=len(rows), mae=float(np.abs(predicted - actual).mean()),
                               bias=float((predicted - actual).mean()),
                               pair_correct=int(((predicted_order == actual_order) & comparable).sum()),
                               comparable_pairs=int(comparable.sum()),
                               top_eight_overlap=len(set(np.argsort(-predicted)[:8]) & set(np.argsort(-actual)[:8]))))
        results[str(season)] = dict(weeks=len(weekly), defenses=sum(w['n'] for w in weekly),
                                    mae=round(float(np.mean([w['mae'] for w in weekly])), 3),
                                    bias=round(float(np.mean([w['bias'] for w in weekly])), 3),
                                    pair_accuracy=round(sum(w['pair_correct'] for w in weekly) /
                                                        sum(w['comparable_pairs'] for w in weekly), 4),
                                    avg_top_eight_overlap=round(float(np.mean([w['top_eight_overlap'] for w in weekly])), 2))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
