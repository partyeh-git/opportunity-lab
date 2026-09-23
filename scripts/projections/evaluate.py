"""One predeclared 2023/2024 comparison on the same player/week cohorts."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
from model import CONFIG, forecast, read_inputs, score
from benchmark import forecast_week


def evaluate(data_dir, output):
    stats,schedule=read_inputs(data_dir,[2022,2023,2024])
    results=[]
    coverage=[]
    for season in (2023,2024):
        for week in range(2,19):
            baseline={p['player_id']:p for p in forecast_week(stats,schedule,season,week,{})}
            candidate={p['id']:p for p in forecast(stats,schedule,season,week,include_ros=False)}
            actual=stats[stats.season.eq(season)&stats.week.eq(week)].set_index('player_id')
            common=set(baseline)&set(candidate)
            coverage.append(dict(season=season,week=week,baseline=len(baseline),candidate=len(candidate),common=len(common)))
            for pid in common:
                b=baseline[pid]; c=candidate[pid]
                obs=actual.loc[pid].to_dict() if pid in actual.index else {}
                truth=score(obs)
                base_score=score(b['models']['opportunity_v0'])
                cand_score=c['week']['full']
                results.append(dict(season=season,week=week,position=c['position'],id=pid,
                    primary=bool(b['primary_cohort']),actual=truth,baseline=base_score,candidate=cand_score,
                    baselineError=abs(base_score-truth),candidateError=abs(cand_score-truth),
                    neutralError=abs(score(c['base'])-truth),
                    baselineCarryError=abs(b['models']['opportunity_v0']['carries']-obs.get('carries',0)),
                    candidateCarryError=abs(c['week']['stats']['carries']-obs.get('carries',0)),
                    baselineTargetError=abs(b['models']['opportunity_v0']['targets']-obs.get('targets',0)),
                    candidateTargetError=abs(c['week']['stats']['targets']-obs.get('targets',0))))
            print(f'Evaluated {season} Week {week}',flush=True)
    frame=pd.DataFrame(results)
    summaries=[]
    for season in (2023,2024):
        for window,lo,hi in [('early',2,4),('later',5,18),('all',2,18)]:
            for position in ('ALL','QB','RB','WR','TE'):
                part=frame[frame.season.eq(season)&frame.week.between(lo,hi)&frame.primary]
                if position!='ALL':part=part[part.position.eq(position)]
                summaries.append(dict(season=season,window=window,position=position,n=len(part),
                    **{col:float(part[col].mean()) for col in ['baselineError','candidateError','neutralError',
                        'baselineCarryError','candidateCarryError','baselineTargetError','candidateTargetError']}))
    week_deltas=[]
    for (season,week),g in frame[frame.primary].groupby(['season','week']):
        week_deltas.append(dict(season=int(season),week=int(week),n=len(g),
            improvement=float((g.baselineError-g.candidateError).mean())))
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    result=dict(protocol=CONFIG,summary=summaries,weeklyDifferences=week_deltas,coverage=coverage,
        modelHash=hashlib.sha256(Path(__file__).with_name('model.py').read_bytes()).hexdigest(),
        caveats=['No significance or superiority claim. Parameters were fixed before this run.',
            '2024 has been inspected in earlier model work and is not an untouched final test.',
            'No injury input; zero outcomes included. Same-player paired comparisons only.',
            'Current candidate model still omits players without current-season observations.',
            '2025 outcomes not loaded by this evaluation. Prior 2025 data is used only for the separate live 2026 forecast.'])
    (output/'evaluation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    frame.to_json(output/'paired-forecasts.jsonl',orient='records',lines=True)
    print(json.dumps([s for s in summaries if s['position']=='ALL'],indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data-dir',required=True);p.add_argument('--output',required=True)
    args=p.parse_args();evaluate(args.data_dir,args.output)
