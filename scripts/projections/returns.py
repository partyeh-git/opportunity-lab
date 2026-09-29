"""Fade ruled-out players back in over the rest of the season.

A player ruled out now (injury report 'Out', or on a reserve list such as IR or PUP) is not
projected at full strength from next week on. Each future game is multiplied by the chance he
plays it, measured from 2019-2023 injury reports and rosters (return_rates.json), relative to a
healthy player. Rest-of-season pair accuracy rose from 67.8% to 71.7% on 2024 and from 67.8% to
72.9% on 2025. Suspensions are not faded: their length is known and handled by the injury ledger.

A timeline reported for the player himself (timelines.py, read from the player notes) overrides
the average: he is out for the games inside it, and the return curve starts at his first game
after it. Reported timelines cannot be backtested (the notes archive starts in September 2026).
"""
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from timelines import games_out

RATES = json.loads(Path(__file__).with_name('return_rates.json').read_text(encoding='utf-8'))
KIND = {'Out': 'Out', 'IR': 'Reserve', 'PUP': 'Reserve', 'NA': 'Reserve'}
SCALED = ('full', 'half')


def kickoffs(games, season, week=None):
    """Kickoff time of each team's game in the target week; without a week, team -> week -> kickoff."""
    g = games[games.season.eq(season) & games.game_type.eq('REG')]
    out = {}
    for r in g[g.week.eq(week)].itertuples() if week else g.itertuples():
        when = datetime.fromisoformat(f'{r.gameday}T{r.gametime}').replace(tzinfo=ZoneInfo('America/New_York'))
        for team in (r.home_team, r.away_team):
            if week:
                out[team] = when
            else:
                out.setdefault(team, {})[int(r.week)] = when
    return out


def games_missed(stats, schedule, season, week, player_id, team):
    """Team games in a row he has sat out going into the target week (this season), capped at 3."""
    played = set(stats[stats.season.eq(season) & stats.player_id.eq(player_id)].week.astype(int))
    team_weeks = sorted(schedule[schedule.season.eq(season) & schedule.team.eq(team) & schedule.week.lt(week)].week.astype(int))
    missed = 0
    for w in reversed(team_weeks):
        if w in played:
            break
        missed += 1
    return min(missed, 3)


def chances(kind, missed, games, fresh):
    """Chance of playing each upcoming game, relative to a healthy player.

    fresh: the status is this week's own designation, so he will not play the first game listed.
    Otherwise the status dates from his last game and the first game listed is one game later.
    """
    curve = RATES['curves'][f'{kind}|{missed}']['relative']
    out = []
    for i in range(games):
        k = i if fresh else i+1
        out.append(0. if k == 0 else curve[min(k, len(curve))-1])
    return out


def timeline_chances(timeline, p, kicks, played):
    """Chances under his own reported timeline: zero inside it, then the return curve of a player
    just ruled out. None when the timeline no longer rules out his next game."""
    out = games_out(timeline, [g['week'] for g in p['games']], kicks, played) if timeline else None
    if not out:
        return None
    curve = RATES['curves']['Out|0']['relative']
    return [0. if i < out else curve[min(i-out, len(curve)-1)] for i in range(len(p['games']))]


def apply_returns(projections, statuses, stats, schedule, games, season, week, as_of, timelines=None):
    """Scale each ruled-out player's future games in place; returns the number of players faded.

    statuses: player id -> live status; 'Out', 'IR', 'PUP' and 'NA' are faded. timelines: player
    id -> reported timeline (timelines.py). Games already zeroed by the injury ledger (a known
    minimum stay) stay zero.
    """
    now = datetime.fromisoformat(as_of)
    kicks, all_kicks = kickoffs(games, season, week), kickoffs(games, season)
    timelines = timelines or {}
    current = stats[stats.season.eq(season)]
    faded = 0
    for p in projections:
        status = statuses.get(p['id'], '')
        kind = KIND.get(status)
        if not (kind or p['id'] in timelines) or not p['games']:
            continue
        kick = kicks.get(p['team'])
        fresh = bool(kick) and p['games'][0]['week'] == week and kick-now <= timedelta(hours=RATES['freshHours'])
        missed = games_missed(stats, schedule, season, week, p['id'], p['team'])
        odds = chances(kind, missed, len(p['games']), fresh) if kind else [1.]*len(p['games'])
        timeline = timelines.get(p['id'])
        # A final game status that leaves him off the Out and Doubtful lines says he is back.
        if fresh and not kind and status != 'Doubtful':
            timeline = None
        played = set(current[current.player_id.eq(p['id'])].week.astype(int))
        own = timeline_chances(timeline, p, all_kicks.get(p['team'], {}), played)
        if not kind and not own:
            continue
        if own:
            odds = [min(a, b) for a, b in zip(odds, own)]
        # This week's own line stays "if he plays"; the site applies his chance to play to it.
        if p.get('week') is p['games'][0]:
            p['week'] = {**p['games'][0], 'stats': dict(p['games'][0]['stats'])}
        for g, chance in zip(p['games'], odds):
            g['returnChance'] = chance
            g['stats'] = {k: v*chance for k, v in g['stats'].items()}
            for key in SCALED:
                g[key] *= chance
        p['rosFull'] = sum(g['full'] for g in p['games'])
        p['rosHalf'] = sum(g['half'] for g in p['games'])
        p['returnOutlook'] = dict(list='injury report' if kind == 'Out' else 'reserve list' if kind else 'reported timeline',
                                  gamesMissed=missed, statusIsForThisWeek=fresh)
        if own:
            out_weeks = [g['week'] for g, chance in zip(p['games'], own) if chance == 0]
            p['returnOutlook']['timeline'] = dict(
                {k: timeline.get(k) for k in ('kind', 'shortest', 'longest', 'published', 'source', 'url')},
                outThroughWeek=max(out_weeks), report=timeline.get('text', '')[:140])
        faded += 1
    return faded
