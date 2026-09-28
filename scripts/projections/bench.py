"""Backtest tool. Current model results are cached once (keyed to the model code + config) and reused.

  scripts/projections/bench.py run NAME '{"workload overrides"}' 2019-2023     # seasons run in parallel; Mac kept awake
  scripts/projections/bench.py compare NAME 2019-2023                            # weekly + ROS vs the cached current model
Outputs: work/bench/<NAME>_<season>.parquet (weekly rows) and _ros.parquet (Weeks 4/8/12)."""
import sys, os, json, hashlib, subprocess, time
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
ROOT = Path(__file__).resolve().parents[2]; OUT = ROOT/'work/bench'; OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT/'scripts/projections'))
os.chdir(ROOT)

def seasons(s):
    if '-' in s: a, b = map(int, s.split('-')); return list(range(a, b+1))
    return [int(x) for x in s.split(',')]

def model_key():
    h = hashlib.sha256()
    for f in ('model.py', 'protocol.json', 'roles.py', 'playing_time.py'):
        h.update((ROOT/'scripts/projections'/f).read_bytes())
    return h.hexdigest()[:12]

def run_season(args):
    name, over, season = args
    import pandas as pd
    from model import read_inputs, forecast, game_context, score, CONFIG
    from roles import read_roles
    from playing_time import read_injury_reports, flag_games, read_unavailable, read_qb1
    D = '.cache/weekly'; Y = [season-1, season]
    stats, sched = read_inputs(D, Y); roles = read_roles(D, Y)
    games = pd.read_csv(D+'/games.csv', low_memory=False); lines = game_context(games)
    playing = flag_games(stats, roles, sched, read_injury_reports(D, Y))
    unav = read_unavailable(D, [season]); qb1 = read_qb1(D, [season], games)
    wl = {**CONFIG['workload'], **(over or {})}
    played = set(zip(stats.season, stats.week, stats.player_id)) | set(zip(roles.season, roles.week, roles.player_id))
    stats['pts'] = [score(r) for r in stats.to_dict('records')]
    act = stats.set_index(['season', 'week', 'player_id']).pts
    rows, ros = [], []
    for week in range(2, 19):
        inc = week in (4, 8, 12)
        for p in forecast(stats, sched, season, week, include_ros=inc, workload=wl, roles=roles, playing=playing,
                          lines=lines, unavailable=unav.get((season, week), set()), qb1=qb1.get((season, week))):
            if p['week']:
                k = (season, week, p['id'])
                rows.append(dict(season=season, week=week, id=p['id'], position=p['position'], team=p['team'],
                                 proj=p['week']['full'], actual=float(act.get(k, 0.)), played=k in played))
            if inc:
                ros.append(dict(season=season, week=week, id=p['id'], position=p['position'], team=p['team'],
                                ros=p['rosFull'], games=p['remainingGames']))
    pd.DataFrame(rows).to_parquet(OUT/f'{name}_{season}.parquet')
    pd.DataFrame(ros).to_parquet(OUT/f'{name}_{season}_ros.parquet')
    return season

def run(name, over, ss):
    todo = ss
    if name == 'base':
        key = model_key(); stamp = OUT/'base.key'
        if stamp.exists() and stamp.read_text() == key:
            todo = [s for s in ss if not (OUT/f'base_{s}_ros.parquet').exists()]
        else:
            for f in OUT.glob('base_*.parquet'): f.unlink()
            stamp.write_text(key)
        if not todo: print('base cached for', ss); return
    awake = subprocess.Popen(['caffeinate', '-i', '-w', str(os.getpid())])  # keep the Mac awake while running
    t = time.time()
    with ProcessPoolExecutor(max_workers=min(len(todo), 7)) as ex:
        for s in ex.map(run_season, [(name, over, s) for s in todo]):
            print(name, s, 'done', round(time.time()-t), 's', flush=True)
    awake.terminate()

def compare(name, ss):
    import numpy as np, pandas as pd
    from scipy import stats as st
    from model import read_inputs, score
    run('base', None, ss)
    load = lambda n, suf='': pd.concat([pd.read_parquet(OUT/f'{n}_{s}{suf}.parquet') for s in ss])
    B, C = load('base'), load(name)
    def pairs(p, a):
        i, j = np.triu_indices(len(p), 1); d = a[i] != a[j]
        return ((p[i] > p[j]) == (a[i] > a[j]))[d].sum(), d.sum()
    b = B[B.played].set_index(['season', 'week', 'id']); c = C[C.played].set_index(['season', 'week', 'id'])
    idx = b.index[b.proj >= 5].intersection(c.index); b, c = b.loc[idx], c.loc[idx]
    eb, ec = (b.proj-b.actual).abs(), (c.proj-c.actual).abs()
    pb, pc = [], []
    for k, g in b.groupby(level=[0, 1]):
        ob = tb = oc = tc = 0
        for _, gg in g.groupby('position'):
            x = pairs(gg.proj.to_numpy(), gg.actual.to_numpy()); y = pairs(c.loc[gg.index].proj.to_numpy(), gg.actual.to_numpy())
            ob += x[0]; tb += x[1]; oc += y[0]; tc += y[1]
        pb.append(ob/tb); pc.append(oc/tc)
    d = eb-ec
    print(f'WEEKLY {name} vs current (played, current proj 5+, n={len(idx)})')
    print('  avg miss %.3f -> %.3f  gain %+.3f (95%% CI %+.3f to %+.3f) p=%.4f' % (eb.mean(), ec.mean(), d.mean(),
          d.mean()-1.96*d.std()/np.sqrt(len(d)), d.mean()+1.96*d.std()/np.sqrt(len(d)), st.ttest_rel(eb, ec).pvalue))
    print('  start/sit pairs %.2f%% -> %.2f%%  p=%.4f' % (np.mean(pb)*100, np.mean(pc)*100, st.ttest_rel(pb, pc).pvalue))
    print('  miss gain by season', {s: round(float(d[d.index.get_level_values(0) == s].mean()), 3) for s in ss})
    print('  by position', {p: round(float(d[b.position.eq(p)].mean()), 3) for p in ('QB', 'RB', 'WR', 'TE')})
    # ROS: fixed pool = current model's top 30 QB / 60 RB / 72 WR / 30 TE; zeros kept
    stats, _ = read_inputs('.cache/weekly', ss); stats['pts'] = [score(r) for r in stats.to_dict('records')]
    RB_, RC = load('base', '_ros'), load(name, '_ros'); TOP = {'QB': 30, 'RB': 60, 'WR': 72, 'TE': 30}; snaps = []
    for (s, cut), g in RB_.groupby(['season', 'week']):
        x = stats[stats.season.eq(s)]; a = x[x.week.ge(cut)].groupby('player_id').pts.sum()
        cc = RC[RC.season.eq(s) & RC.week.eq(cut)].set_index('id'); gg = g.set_index('id'); r = [0, 0, 0, 0]
        for pos, h in g.groupby('position'):
            if pos not in TOP: continue
            ids = h.nlargest(TOP[pos], 'ros').id.to_numpy(); aa = a.reindex(ids).fillna(0).to_numpy()
            o = pairs(gg.ros.reindex(ids).to_numpy(), aa); n = pairs(cc.ros.reindex(ids).fillna(0).to_numpy(), aa)
            r[0] += o[0]; r[1] += o[1]; r[2] += n[0]; r[3] += n[1]
        snaps.append((s, cut, r[0]/r[1]*100, r[2]/r[3]*100))
    sn = pd.DataFrame(snaps, columns=['season', 'cut', 'base', 'new']); dd = sn.new-sn.base
    ci = st.t.ppf(.975, len(dd)-1)*dd.std()/np.sqrt(len(dd)) if len(dd) > 1 else float('nan')
    print(f'ROS pairs {sn.base.mean():.2f}% -> {sn.new.mean():.2f}%  gain {dd.mean():+.2f} (95% CI {dd.mean()-ci:+.2f} to {dd.mean()+ci:+.2f})'
          f' p={st.ttest_1samp(dd, 0).pvalue if len(dd) > 1 else float("nan"):.4f}  better in {(dd > 0).sum()}/{len(dd)} snapshots')
    print('  by cutoff', sn.assign(d=dd).groupby('cut').d.mean().round(2).to_dict(), ' by season', sn.assign(d=dd).groupby('season').d.mean().round(2).to_dict())

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'run': run(sys.argv[2], json.loads(sys.argv[3]), seasons(sys.argv[4]))
    elif cmd == 'compare': compare(sys.argv[2], seasons(sys.argv[3]))
