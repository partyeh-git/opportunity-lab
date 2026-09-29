"""Fade ruled-out players back in over the rest of the season.

A player ruled out now (injury report 'Out', or on a reserve list such as IR or PUP) is not
projected at full strength from next week on. Each future game is multiplied by the chance he
plays it, measured from past injury reports and rosters (return_rates.json), relative to a
healthy player. Injury report 'Out': by games already missed, fit 2019-2023. Injured reserve, PUP
and NFI: zero until 4 games are served on the list (the rule since 2022), then the return rates
measured under that rule, fit 2022-2023. Suspensions are not faded: their length is known and
handled by the injury ledger.

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
KIND = {'Out': 'Out', 'IR': 'List', 'PUP': 'List', 'NA': 'List'}
# nflverse roster codes: injured reserve, PUP and NFI. Other reserve lists (suspension) are not these.
LIST_CODES = ('R01', 'R48', 'R04', 'R05')
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


def games_missed(stats, schedule, season, week, player_id, team, cap=3):
    """Team games in a row he has sat out going into the target week (this season), capped."""
    played = set(stats[stats.season.eq(season) & stats.player_id.eq(player_id)].week.astype(int))
    team_weeks = sorted(schedule[schedule.season.eq(season) & schedule.team.eq(team) & schedule.week.lt(week)].week.astype(int))
    missed = 0
    for w in reversed(team_weeks):
        if w in played:
            break
        missed += 1
    return min(missed, cap)


def read_listed(path, season):
    """(week, player id) pairs on injured reserve, PUP or NFI, from nflverse weekly rosters; None if missing."""
    if not Path(path).exists():
        return None
    r = pd.read_csv(path, usecols=['season', 'week', 'gsis_id', 'status_description_abbr', 'game_type'], low_memory=False)
    r = r[r.season.eq(season) & r.game_type.eq('REG') & r.status_description_abbr.isin(LIST_CODES)]
    return set(zip(r.week.astype(int), r.gsis_id))


def games_served(listed, schedule, season, week, player_id, team):
    """Team games in a row he has spent on the list going into the target week; None if the
    roster history does not reach his team's last game (then games missed in a row stand in)."""
    team_weeks = sorted(schedule[schedule.season.eq(season) & schedule.team.eq(team) & schedule.week.lt(week)].week.astype(int))
    if listed is None or not team_weeks or not any(w >= team_weeks[-1] for w, _ in listed):
        return None
    served = 0
    for w in reversed(team_weeks):
        if (w, player_id) not in listed:
            break
        served += 1
    return served


def chances_out(missed, games, fresh):
    """Injury report 'Out': chance of playing each upcoming game, relative to a healthy player.

    missed: games in a row he had sat out before the game the status is for.
    fresh: the status is this week's own designation, so he will not play the first game listed.
    Otherwise the status dates from his last game and the first game listed is one game later.
    """
    curve = RATES['curves'][f'Out|{min(missed, 3)}']['relative']
    out = []
    for i in range(games):
        k = i if fresh else i+1
        out.append(0. if k == 0 else curve[min(k, len(curve))-1])
    return out


def chances_list(served, games, fresh=True):
    """Injured reserve, PUP or NFI: he must miss at least 4 games on the list, then returns at the
    rates measured under that rule (2022-2023), relative to a healthy player.

    served: games already spent on the list going into the first game listed.
    fresh: he is on the list for the first game listed and will miss it. Otherwise his listing
    dates from his last game; a player listed since that game has served none and misses this one.
    """
    lists, healthy = RATES['lists'], RATES['healthy']
    if not fresh and served > 0:
        served, ahead = served-1, 1
    else:
        ahead = 0
    # served is now games on the list before the game his listing is known for; that game is missed.
    past = served-lists['minimumGames']
    curve = lists['inside' if past < 0 else 'past1to2' if past < 2 else 'past3plus']['played']
    out, best = [], 0.
    for i in range(games):
        k = i+ahead  # games after the one he is known to miss
        step = served+k-lists['minimumGames'] if past < 0 else k-1
        if k == 0 or step < 0:
            out.append(0.)
            continue
        best = max(best, min(1., curve[min(step, len(curve)-1)]/healthy[min(k, len(healthy))-1]))
        out.append(best)
    return out


def timeline_chances(timeline, p, kicks, played):
    """Chances under his own reported timeline: zero inside it, then the return curve of a player
    just ruled out. None when the timeline no longer rules out his next game."""
    out = games_out(timeline, [g['week'] for g in p['games']], kicks, played) if timeline else None
    if not out:
        return None
    curve = RATES['curves']['Out|0']['relative']
    return [0. if i < out else curve[min(i-out, len(curve)-1)] for i in range(len(p['games']))]


def apply_returns(projections, statuses, stats, schedule, games, season, week, as_of, timelines=None,
                  listed=None, pending_teams=()):
    """Scale each ruled-out player's future games in place; returns the number of players faded.

    statuses: player id -> live status; 'Out', 'IR', 'PUP' and 'NA' are faded. timelines: player
    id -> reported timeline (timelines.py). listed: read_listed(), for games served on a list.
    pending_teams: an early build's teams whose last game is still to be played (it is not in
    schedule); their status is for that game. Games already zeroed by the injury ledger stay zero.
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
        missed = games_missed(stats, schedule, season, week, p['id'], p['team'], cap=18)
        served = None
        # A status from his last game already counts that game: look up the games missed before it.
        # An early build's pending teams have not played it, so their count stops short of it already.
        stale_played = not fresh and p['team'] not in pending_teams
        if kind == 'List':
            served = games_served(listed, schedule, season, week, p['id'], p['team'])
            served = missed if served is None else served
            if p['team'] in pending_teams and not fresh:
                served += 1  # listed for the game still to be played: he will have served it too
            odds = chances_list(served, len(p['games']), fresh)
        elif kind:
            odds = chances_out(max(missed-1, 0) if stale_played else missed, len(p['games']), fresh)
        else:
            odds = [1.]*len(p['games'])
        missed = min(missed, 3)
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
                                  gamesMissed=missed, statusIsForThisWeek=fresh,
                                  **({'gamesOnList': served} if served is not None else {}))
        if own:
            out_weeks = [g['week'] for g, chance in zip(p['games'], own) if chance == 0]
            p['returnOutlook']['timeline'] = dict(
                {k: timeline.get(k) for k in ('kind', 'shortest', 'longest', 'published', 'source', 'url')},
                outThroughWeek=max(out_weeks), report=timeline.get('text', '')[:140])
        faded += 1
    return faded
