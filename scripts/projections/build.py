"""Generate an auditable snapshot; never downloads or evaluates held-out seasons."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from model import CAMEL, CONFIG, STATS, forecast, read_inputs


def public_stats(s):
    return {CAMEL[k]:round(float(s[k]),6) for k in STATS}


def build(data_dir, existing_path, output, season, week):
    stats, schedule = read_inputs(data_dir,[season-1,season])
    current = stats[stats.season.eq(season)]
    if current.week.max() != week-1:
        raise ValueError('Source data must end at the previous completed week')
    expected = set(schedule[schedule.season.eq(season)&schedule.week.eq(week-1)].game_id)
    observed = set(current[current.week.eq(week-1)].game_id)
    if expected != observed:
        raise ValueError('Previous week is incomplete')
    original = json.loads(Path(existing_path).read_text(encoding='utf-8'))
    identities = {p['id']:p for p in original['players']}
    projections = forecast(stats,schedule,season,week)
    rows = []
    for p in projections:
        current_game = p['week']
        old = identities.get(p['id'],{})
        row = {k:p[k] for k in ('id','name','position','team','lastObservedWeek','remainingGames','workloadEvidence')}
        if old.get('sleeperId'):
            row['sleeperId'] = old['sleeperId']
        row.update(opponent=current_game['opponent'] if current_game else 'BYE',
            projected=public_stats(current_game['stats'] if current_game else dict.fromkeys(STATS,0.)),
            neutralProjected=public_stats(p['base']),
            weekFull=round(current_game['full'],4) if current_game else 0.,
            weekHalf=round(current_game['half'],4) if current_game else 0.,
            rosFull=round(p['rosFull'],4),rosHalf=round(p['rosHalf'],4),
            matchupFactors=current_game['defense'] if current_game else {},
            weeklyForecasts=[dict(week=g['week'],opponent=g['opponent'],projected=public_stats(g['stats']),
                full=round(g['full'],4),half=round(g['half'],4)) for g in p['games']])
        rows.append(row)
    rows.sort(key=lambda p:p['weekFull'],reverse=True)
    hashes = {f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in [
        Path(data_dir)/f'stats_player_week_{season-1}.csv',Path(data_dir)/f'stats_player_week_{season}.csv',Path(data_dir)/'games.csv']}
    payload = dict(season=season,week=week,dataThroughWeek=week-1,
        generatedAt=datetime.now(timezone.utc).isoformat(),model=CONFIG['model'],
        source='nflverse weekly player statistics and schedule; no external rankings',
        candidateCount=len(rows),methodology=CONFIG,sourceHashes=hashes,
        modelHash=hashlib.sha256(Path(__file__).with_name('model.py').read_bytes()).hexdigest(),players=rows)
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
    args=parser.parse_args()
    build(args.data_dir,args.identities,args.output,args.season,args.week)
