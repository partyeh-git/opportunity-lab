"""Normalize public status observations plus an explicitly reviewed official ledger.

Fetch raw sources separately. Retrieval time is NOT an injury publication time.
No ranking or projected-points data are read from the status feeds.
"""
import argparse
import hashlib
import json
from pathlib import Path
import pandas as pd
from model import schedule_rows
from availability import timestamp


def prepare(snapshot_path, sleeper_path, injuries_path, games_path, review_path, fetched_at, output):
    snapshot = json.loads(Path(snapshot_path).read_text(encoding='utf-8'))
    sleeper = json.loads(Path(sleeper_path).read_text(encoding='utf-8'))
    review = json.loads(Path(review_path).read_text(encoding='utf-8'))
    season, week = snapshot['season'], snapshot['week']
    if (review['season'], review['week']) != (season, week):
        raise ValueError('Review must match projection season/week')
    if abs((timestamp(review['reviewedAt'])-timestamp(fetched_at)).total_seconds()) > 48*3600:
        raise ValueError('Status feed must be refreshed within 48 hours of review')
    injuries = pd.read_csv(injuries_path).fillna('')
    injuries = injuries[injuries.season.eq(season) & injuries.season_type.eq('REG') & injuries.week.le(week)]
    fixtures = schedule_rows(pd.read_csv(games_path))
    aliases = {'LAR': 'LA', 'JAC': 'JAX'}
    rows = {}
    for p in snapshot['players']:
        s = sleeper.get(p['sleeperId'], {})
        status = s.get('injury_status')
        injury = s.get('injury_body_part') or ''
        source = []
        if status and aliases.get(s.get('team'), s.get('team')) == p['team'] and s.get('position') == p['position']:
            source.append(dict(kind='status_feed', title='Sleeper player status (game week unspecified)',
                url='https://api.sleeper.app/v1/players/nfl', retrievedAt=fetched_at))
        else:
            status, injury = '', ''
        old = injuries[injuries.gsis_id.eq(p['id']) & injuries.team.eq(p['team'])].sort_values('week').tail(1)
        if len(old) and old.iloc[0].report_status:
            i = old.iloc[0]
            source.append(dict(kind='weekly_report', title=f'nflverse Week {int(i.week)} injury report: {i.report_status}',
                url=f'https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv',
                retrievedAt=fetched_at, reportWeek=int(i.week)))
            status = status or str(i.report_status)
            injury = injury or str(i.report_primary_injury)
        if source:
            rows[p['id']] = dict(id=p['id'], team=p['team'], reportedStatus=status,
                injury=injury, outWeeks=[], sources=source,
                note='Source flag requires a current-week availability check. A prior-week or week-unspecified Out flag does not establish a new absence. Points are conditional on playing.')
    for r in review['records']:
        p = next((p for p in snapshot['players'] if p['id'] == r['id']), None)
        if not p or p['team'] != r['team']:
            raise ValueError('Reviewed player is missing or on a different modeled team')
        future = fixtures[fixtures.season.eq(season) & fixtures.team.eq(r['team'])]
        out = r.get('outWeeks', [])
        if 'minimumMissedGames' in r:
            out = future[future.week.ge(r['firstMissedWeek'])].sort_values('week').head(r['minimumMissedGames']).week.astype(int).tolist()
            if len(out) != r['minimumMissedGames']:
                raise ValueError('Insufficient schedule to establish minimum absence')
        previous_sources = rows.get(r['id'], {}).get('sources', [])
        rows[r['id']] = dict(id=r['id'], team=r['team'], reportedStatus=r['reportedStatus'],
            injury=r['injury'], outWeeks=out, note=r['note'],
            sources=[dict(kind=r.get('sourceKind', 'official'), title=r['sourceTitle'], url=r['sourceUrl'],
                publishedDate=r['publishedDate'], retrievedAt=review['reviewedAt']), *previous_sources])
        for key in ('replacementId', 'replacementWeeks'):
            if key in r:
                rows[r['id']][key] = r[key]
    payload = dict(season=season, week=week, reviewedAt=review['reviewedAt'],
        coverage=dict(latestInjuryReportWeek=int(injuries.week.max()) if len(injuries) else None,
            currentWeekReports=int(injuries.week.eq(week).sum()),
            flaggedPlayers=len(rows), officiallyReviewedPlayers=len(review['records']),
            note='Public-feed flags plus selected official-source reviews; not comprehensive current-week game-day clearance.'),
        sourceHashes={Path(f).name:hashlib.sha256(Path(f).read_bytes()).hexdigest()
            for f in (sleeper_path, injuries_path, review_path)},
        players=list(rows.values()))
    Path(output).write_text(json.dumps(payload, indent=2), encoding='utf-8')
    print(json.dumps(payload['coverage']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for arg in ('snapshot', 'sleeper', 'injuries', 'games', 'review', 'fetched-at', 'output'):
        parser.add_argument('--'+arg, required=True)
    a = parser.parse_args()
    prepare(a.snapshot, a.sleeper, a.injuries, a.games, a.review, a.fetched_at, a.output)
