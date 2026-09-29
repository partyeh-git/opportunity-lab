"""Generate an auditable snapshot; never downloads or evaluates held-out seasons."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
from model import CAMEL, CONFIG, STATS, forecast, game_context, read_inputs
from playing_time import flag_games, read_injury_reports
from roles import read_roles
from availability import apply_availability, load_evidence
from returns import apply_returns, read_listed
from timelines import read_timelines, with_overrides


def public_stats(s):
    return {CAMEL[k]:round(float(s[k]),6) for k in STATS}


def live_status(data_dir, identities):
    """From Sleeper's player directory: players who cannot play (IR/PUP/suspended/Out) and each
    team's depth-chart QB1, as nflverse ids (our snapshot's id map first, Sleeper's gsis_id second)."""
    path = Path(data_dir)/'sleeper_players.json'
    if not path.exists():
        return set(), None, {}
    sleeper = json.loads(path.read_text(encoding='utf-8'))
    to_gsis = {p['sleeperId']: pid for pid, p in identities.items() if p.get('sleeperId')}
    gsis = lambda sid, v: to_gsis.get(sid) or (v.get('gsis_id') or '').strip() or None
    fix = {'LAR':'LA','JAC':'JAX','WSH':'WAS'}
    out = {gsis(k, v) for k, v in sleeper.items() if v.get('injury_status') in ('IR','PUP','Sus','Out','NA')} - {None}
    qb1 = {fix.get(v['team'],v['team']): gsis(k, v) for k, v in sleeper.items()
           if v.get('team') and v.get('depth_chart_position')=='QB' and v.get('depth_chart_order')==1 and gsis(k, v)}
    status = {gsis(k, v): v['injury_status'] for k, v in sleeper.items() if v.get('injury_status') and gsis(k, v)}
    return out, qb1, status


def reported_timelines(data_dir, identities, season, as_of):
    """Each player's own reported recovery timeline, from the archived notes (timelines.py)."""
    path, root = Path(data_dir)/'sleeper_players.json', Path(__file__).resolve().parents[2]
    if not path.exists():
        return {}
    ids = {p['sleeperId']: pid for pid, p in identities.items() if p.get('sleeperId')}
    found = read_timelines(root/'public'/'notes', json.loads(path.read_text(encoding='utf-8')), ids, season, as_of)
    return with_overrides(found, Path(__file__).with_name('timeline-overrides.json'))


def build(data_dir, existing_path, output, season, week, availability_path=None, as_of=None, early=False):
    as_of = as_of or datetime.now(timezone.utc).isoformat()
    stats, schedule = read_inputs(data_dir,[season-1,season])
    # A mid-week rebuild (fresh lines/injuries) can see games already played this week: drop them.
    stats = stats[~(stats.season.eq(season)&stats.week.ge(week))]
    current = stats[stats.season.eq(season)]
    if current.week.max() != week-1:
        raise ValueError('Source data must end at the previous completed week')
    expected = set(schedule[schedule.season.eq(season)&schedule.week.eq(week-1)].game_id)
    observed = set(current[current.week.eq(week-1)].game_id)
    pending_teams = []
    if expected != observed:
        # An early build (Monday morning) may run before the week's last games are played. Those
        # games leave the schedule entirely: their teams are projected from the week before.
        pending = expected - observed
        results = pd.read_csv(Path(data_dir)/'games.csv',low_memory=False)
        played = set(results[results.result.notna()].game_id)
        if not early or observed - expected or pending & played or not observed:
            raise ValueError('Previous week is incomplete')
        pending_teams = sorted(set(schedule[schedule.game_id.isin(pending)].team))
        schedule = schedule[~schedule.game_id.isin(pending)]
    original = json.loads(Path(existing_path).read_text(encoding='utf-8'))
    identities = {p['id']:p for p in original['players']}
    roles = read_roles(data_dir,[season-1,season])
    # Minimal-playing-time rule and betting-implied points (see protocol.json "workload").
    playing = flag_games(stats,roles,schedule,read_injury_reports(data_dir,[season-1,season]))
    lines = game_context(pd.read_csv(Path(data_dir)/'games.csv',low_memory=False))
    unavailable, qb1, statuses = live_status(data_dir, identities)
    projections = forecast(stats,schedule,season,week,roles=roles,playing=playing,lines=lines,
                           unavailable=unavailable,qb1=qb1)
    evidence, allocations = None, []
    if availability_path:
        evidence = load_evidence(availability_path,season,week,as_of)
        projections, allocations = apply_availability(projections,stats,evidence,season,week)
    # Ruled-out players fade back in over the following games (returns.py).
    faded = apply_returns(projections,statuses,stats,schedule,pd.read_csv(Path(data_dir)/'games.csv',low_memory=False),season,week,as_of,
                          reported_timelines(data_dir,identities,season,as_of),
                          read_listed(Path(data_dir)/f'roster_weekly_{season}.csv',season),pending_teams)
    rows = []
    for p in projections:
        current_game = p['week']
        old = identities.get(p['id'],{})
        row = {k:p[k] for k in ('id','name','position','team','lastObservedWeek','remainingGames','workloadEvidence')}
        row['sleeperId'] = old.get('sleeperId','')
        if evidence:
            row['availability'] = p['availability']
            row['roleAdjustments'] = p['roleAdjustments']
        row.update(opponent=current_game['opponent'] if current_game else 'BYE',
            projected=public_stats(current_game['stats'] if current_game else dict.fromkeys(STATS,0.)),
            neutralProjected=public_stats(p['base']),
            weekFull=round(current_game['full'],4) if current_game else 0.,
            weekHalf=round(current_game['half'],4) if current_game else 0.,
            rosFull=round(p['rosFull'],4),rosHalf=round(p['rosHalf'],4),
            matchupFactors=current_game['defense'] if current_game else {},
            weeklyForecasts=[dict(week=g['week'],opponent=g['opponent'],projected=public_stats(g['stats']),
                full=round(g['full'],4),half=round(g['half'],4),
                availability=g.get('availability','if_active'),
                **({'returnChance':round(g['returnChance'],3)} if 'returnChance' in g else {})) for g in p['games']])
        if 'returnOutlook' in p:
            row['returnOutlook'] = p['returnOutlook']
        rows.append(row)
    rows.sort(key=lambda p:p['weekFull'],reverse=True)
    hashes = {f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in [
        Path(data_dir)/f'stats_player_week_{season-1}.csv',Path(data_dir)/f'stats_player_week_{season}.csv',Path(data_dir)/'games.csv',
        Path(data_dir)/f'snap_counts_{season-1}.parquet',Path(data_dir)/f'snap_counts_{season}.parquet',Path(data_dir)/'players.csv']}
    payload = dict(season=season,week=week,dataThroughWeek=week-1,
        generatedAt=as_of,model=CONFIG['model'],returnFadePlayers=faded,
        reportedTimelinePlayers=sum('timeline' in p.get('returnOutlook',{}) for p in rows),
        source='nflverse weekly player statistics, schedule and PFR snap counts; reviewed official availability and public status flags; no external rankings',
        candidateCount=len(rows),unmappedIdentityCount=sum(not p['sleeperId'] for p in rows),methodology=CONFIG,sourceHashes=hashes,
        modelHash=hashlib.sha256(Path(__file__).with_name('model.py').read_bytes()).hexdigest(),players=rows)
    if early:
        payload['pendingTeams'] = pending_teams
    if evidence:
        payload['methodology'] = {**CONFIG, 'limitations':[
            'Verified absences are applied by a separate prospective overlay. Unresolved availability, return workload, routes run, red-zone locations, coaching, weather, and designed-run/scramble split are not quantified; snap share informs WR/TE/RB volume.'
                if item.startswith('Snap share (PFR snap counts)') else
            'Future workload follows the sample-aware role estimate except for explicitly explained confirmed-absence adjustments; later return dates remain conditional.'
                if item.startswith('Future workload is held') else item for item in CONFIG['limitations']]}
        payload['availabilitySummary'] = {**evidence['coverage'], 'reviewedAt':evidence['reviewedAt'],
            'confirmedOutPlayers':sum(p['availability']['state']=='confirmed_out' for p in rows),
            'method':'confirmed_absences_observed_role_delta_v1; prospective, not historically validated',
            'allocations':allocations}
        payload['sourceHashes'][Path(availability_path).name] = hashlib.sha256(Path(availability_path).read_bytes()).hexdigest()
        payload['availabilityModelHash'] = hashlib.sha256(Path(__file__).with_name('availability.py').read_bytes()).hexdigest()
    Path(output).parent.mkdir(parents=True,exist_ok=True)
    Path(output).write_text(json.dumps(payload,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'count':len(rows),'topFive':[{k:p[k] for k in ('name','weekFull','rosFull')} for p in rows[:5]],
        'walker':{k:v for k,v in next(p for p in rows if p['name']=='Kenneth Walker III').items() if k!='weeklyForecasts'}},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--data-dir',required=True)
    parser.add_argument('--identities',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--season',type=int,default=2026)
    parser.add_argument('--week',type=int,default=3)
    parser.add_argument('--availability',required=True,help='Reviewed, week-specific availability snapshot')
    parser.add_argument('--as-of',help='Frozen evidence cutoff (ISO timestamp); defaults to now')
    parser.add_argument('--early',action='store_true',help="allow last week's unplayed games to be missing (Monday morning build)")
    args=parser.parse_args()
    build(args.data_dir,args.identities,args.output,args.season,args.week,args.availability,args.as_of,args.early)
