"""Past-only, sample-aware workloads and separate position/defense channels.

External rankings are never inputs. Uncertainty weights are not p-values.
"""
from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd

from roles import blend, role_inputs

CONFIG = json.loads(Path(__file__).with_name('protocol.json').read_text())
POSITIONS = ('QB', 'RB', 'WR', 'TE')
STATS = ['attempts', 'completions', 'passing_yards', 'passing_tds', 'passing_interceptions',
         'carries', 'rushing_yards', 'rushing_tds', 'targets', 'receptions', 'receiving_yards',
         'receiving_tds', 'fumbles_lost_total', 'passing_2pt_conversions',
         'rushing_2pt_conversions', 'receiving_2pt_conversions', 'special_teams_tds', 'fumble_recovery_tds']
RATES = {
    'catch': ('receptions', 'targets', 20),
    'receiving': ('receiving_yards', 'targets', 30),
    'rushing': ('rushing_yards', 'carries', 30),
    'passing': ('passing_yards', 'attempts', 100),
    'receiving_td': ('receiving_tds', 'targets', 100),
    'rushing_td': ('rushing_tds', 'carries', 100),
    'passing_td': ('passing_tds', 'attempts', 150),
    'interceptions': ('passing_interceptions', 'attempts', 100),
}
CAMEL = dict(zip(STATS, ['passingAttempts', 'completions', 'passingYards', 'passingTds',
    'passingInterceptions', 'carries', 'rushingYards', 'rushingTds', 'targets', 'receptions',
    'receivingYards', 'receivingTds', 'fumblesLost', 'passing2pt', 'rushing2pt', 'receiving2pt',
    'specialTeamsTds', 'fumbleRecoveryTds']))


def score(s, ppr=1., interception=-2.):
    g = lambda k: s.get(k, 0.)
    return (.04*g('passing_yards') + .1*(g('rushing_yards')+g('receiving_yards'))
        +4*g('passing_tds')+6*(g('rushing_tds')+g('receiving_tds')+g('special_teams_tds')+g('fumble_recovery_tds'))
        +ppr*g('receptions')+interception*g('passing_interceptions')-2*g('fumbles_lost_total')
        +2*(g('passing_2pt_conversions')+g('rushing_2pt_conversions')+g('receiving_2pt_conversions')))


def schedule_rows(games):
    g = games[games.game_type.eq('REG')]
    return pd.concat([
        g[['season','week','game_id','home_team','away_team']].rename(columns={'home_team':'team','away_team':'opponent'}),
        g[['season','week','game_id','away_team','home_team']].rename(columns={'away_team':'team','home_team':'opponent'})
    ], ignore_index=True)


def weighted_window(frame, game_ids):
    window = frame.set_index('game_id')[STATS].reindex(game_ids).fillna(0.)
    w = .8 ** np.arange(len(window)-1, -1, -1)
    return dict(zip(STATS, (w @ window.to_numpy()) / w.sum()))


def fit_defenses(history, season):
    """Observed / offense-adjusted expected efficiency, pooled by defense AND position.

Expected player rates exclude the evaluated game from their player totals.
All fitting data must predate the forecast cutoff. This is an estimate of
current defensive strength, not a replay of earlier publication-time ratings.
"""
    h = history[history.season.ge(season-1)].copy()
    if h.empty:
        return {}
    h['weight'] = np.where(h.season.eq(season), 1., CONFIG['previous_season_defense_weight'])
    totals = h.groupby('player_id')[STATS].transform('sum')
    positional = h.groupby('position')[STATS].sum()
    fitted = {}
    for channel, (num, den, strength) in RATES.items():
        priors = (positional[num] / positional[den].clip(lower=1)).to_dict()
        base = h.position.map(priors)
        player_rate = (totals[num]-h[num]+strength*base)/(totals[den]-h[den]+strength)
        expected = h[den]*player_rate
        x = pd.DataFrame({'defense':h.opponent_team, 'position':h.position,
            'observed':h[num]*h.weight, 'expected':expected*h.weight,
            'opportunities':h[den]*h.weight})
        for (defense, pos), row in x.groupby(['defense','position']).sum().iterrows():
            n = float(row.opportunities)
            reliability = n/(n+CONFIG['defense_pseudo_opportunities'][channel])
            ratio = float(row.observed/row.expected) if row.expected > 0 else 1.
            factor = float(np.clip(1+(ratio-1)*reliability, *CONFIG['defense_factor_bounds']))
            fitted[(defense,pos,channel)] = dict(factor=factor, weightedOpportunities=n, reliability=reliability)
    return fitted


def apply_matchup(base, defense, position, defenses, weeks_ahead=0):
    adjusted = base.copy()
    factors = {}
    decay = CONFIG['future_defense_decay_per_week'] ** weeks_ahead
    for channel, (num, _, _) in RATES.items():
        record = defenses.get((defense,position,channel), {'factor':1.,'weightedOpportunities':0.,'reliability':0.})
        factor = 1+(record['factor']-1)*decay
        adjusted[num] *= factor
        factors[channel] = {**record, 'factor':factor}
    adjusted['receptions'] = min(adjusted['targets'], adjusted['receptions'])
    adjusted['receiving_tds'] = min(adjusted['receptions'], adjusted['receiving_tds'])
    adjusted['rushing_tds'] = min(adjusted['carries'], adjusted['rushing_tds'])
    adjusted['passing_tds'] = min(adjusted['attempts'], adjusted['passing_tds'])
    adjusted['passing_interceptions'] = min(adjusted['attempts'], adjusted['passing_interceptions'])
    return adjusted, factors


VOLUME = ('attempts', 'carries', 'targets')
# Workload options. Defaults reproduce sample_aware_matchup_v1 exactly; Phase B fix 2
# candidates are evaluated through these switches before any default changes.
DEFAULT_WORKLOAD = dict(window=4, decay=.8, prior_games=None, changed_team_prior_games=None,
                        skip_absences=False, skip_short_games=False, context=None,
                        reconcile_active_only=False, volume_override=None, role_blend=None,
                        clean_games=False, role_prior=False, implied=None)


def game_context(games):
    """Pregame expected margin and implied points per (game_id, team), from the betting line only."""
    g = games[games.game_type.eq('REG')]
    home = dict(zip(zip(g.game_id, g.home_team), zip(g.spread_line, (g.total_line+g.spread_line)/2)))
    away = dict(zip(zip(g.game_id, g.away_team), zip(-g.spread_line, (g.total_line-g.spread_line)/2)))
    return {**home, **away}


def player_window(own, team_game_ids, position, wl):
    """Recent volume from the team's games so far, most recent weighted most.

    Optional: skip games a regular missed (not zero-usage games), skip games cut short
    (unusually low usage followed by a missed game), and express each game at a neutral
    game script using that game's pregame line. Returns (volume dict, games of evidence).
    """
    rows = own.set_index('game_id')
    vol = rows[list(VOLUME)].reindex(team_game_ids)
    played = vol.notna().all(axis=1)
    total = vol.sum(axis=1, min_count=1)
    regular = played.any() and total[played].mean() >= 5
    keep = pd.Series(True, index=vol.index)
    if wl['skip_absences'] and regular:
        keep &= played
    if wl['skip_short_games'] and played.sum() >= 2:
        next_played = played.shift(-1, fill_value=True).astype(bool)
        for gid in vol.index[played]:
            others = total[played & (total.index != gid)]
            if not next_played[gid] and total[gid] < .5*others.median():
                keep[gid] = False
    vol = vol.fillna(0.).astype(float)
    ctx = wl['context']
    if ctx:
        for gid in vol.index:
            margin, implied = ctx['lines'].get((gid, ctx['team']), (0., 22.))
            for key in VOLUME:
                bm, bi = ctx['coef'].get((position, key), (0., 0.))
                vol.loc[gid, key] /= np.exp(bm*margin + bi*(implied-22.))
    vol = vol[keep].tail(wl['window'])
    if vol.empty:
        return {k: 0. for k in VOLUME}, 0
    w = wl['decay'] ** np.arange(len(vol)-1, -1, -1)
    return dict(zip(VOLUME, (w @ vol.to_numpy()) / w.sum())), int(keep.sum())


def clean_window(own, window, decay):
    """Volume from the player's last `window` clean games (played, not cut short), newest weighted most."""
    rows = own.sort_values(['season','week']).tail(window)
    if rows.empty:
        return None
    w = decay ** np.arange(len(rows)-1, -1, -1)
    return dict(zip(STATS, (w @ rows[STATS].to_numpy()) / w.sum()))


def forecast(stats, schedule, season, cutoff_week, include_ros=True, workload=None, roles=None,
             playing=None, lines=None, unavailable=None, qb1=None):
    """playing: playing_time.flag_games output (needed for clean_games / role_prior).
    lines: game_context(games) output (needed for implied).
    unavailable: player ids known pregame to miss the forecast week (IR, cut, ruled Out); they
    keep a projection for later weeks but do not use up this team's volume.
    qb1: {team: player id} depth-chart starting QB this week. Only one QB plays: other QBs on that
    team get no volume (a backup's old fill-in starts do not make him a starter again)."""
    wl = {**DEFAULT_WORKLOAD, **(workload or {})}
    if workload is None and CONFIG.get('workload'):
        wl = {**wl, **CONFIG['workload']}
    default_workload = not any(wl[k] != DEFAULT_WORKLOAD[k] for k in DEFAULT_WORKLOAD
                               if k not in ('clean_games', 'role_prior', 'implied'))
    partial = set()
    shares = {}
    if playing is not None and (wl['clean_games'] or wl['role_prior']):
        from playing_time import partial_keys
        if wl['clean_games']:
            partial = partial_keys(playing, season, cutoff_week)
        pl = playing[(playing.season.lt(season)) | (playing.season.eq(season)&playing.week.lt(cutoff_week))]
        shares = dict(zip(zip(pl.season, pl.week, pl.player_id), pl.snap_share))
    history = stats[(stats.season.lt(season)) | (stats.season.eq(season)&stats.week.lt(cutoff_week))].copy()
    if partial:
        keys = list(zip(history.season, history.week, history.player_id))
        history['partial'] = [k in partial for k in keys]
    else:
        history['partial'] = False
    history = history[history.position.isin(POSITIONS)].sort_values(['season','week','player_id'])
    current = history[history.season.eq(season)]
    previous = history[history.season.eq(season-1)]
    if current.empty or previous.empty:
        raise ValueError('Current observations and prior-season statistics are required')
    defenses = fit_defenses(history, season)
    pos_totals = history[history.season.ge(season-1)].groupby('position')[STATS].sum()
    fixtures = schedule[schedule.season.eq(season)&schedule.week.ge(cutoff_week)]
    prior_schedule = schedule[(schedule.season.eq(season)&schedule.week.lt(cutoff_week)) | schedule.season.eq(season-1)]
    histories = dict(tuple(history.groupby('player_id')))
    team_totals = history.groupby(['season','team','game_id'],as_index=False)[STATS].sum()
    team_forecasts = {}
    for team in current.team.unique():
        recent_ids = prior_schedule[prior_schedule.season.eq(season)&prior_schedule.team.eq(team)].sort_values('week').tail(4).game_id.tolist()
        if not recent_ids:
            continue
        recent_team = weighted_window(team_totals[team_totals.season.eq(season)&team_totals.team.eq(team)], recent_ids)
        old_team = team_totals[team_totals.season.eq(season-1)&team_totals.team.eq(team)]
        old_mean = old_team[STATS].mean().to_dict() if len(old_team) else recent_team
        w = len(recent_ids)/(len(recent_ids)+CONFIG['team_prior_games'])
        team_forecasts[team] = {k: w*recent_team[k]+(1-w)*old_mean[k] for k in STATS}
    players = []
    for identity in current.groupby('player_id',sort=False).tail(1).itertuples():
        team = identity.team
        future = fixtures[fixtures.team.eq(team)].sort_values('week')
        if future.empty or team not in team_forecasts:
            continue
        hist = histories[identity.player_id]
        team_ids = prior_schedule[prior_schedule.season.eq(season)&prior_schedule.team.eq(team)].sort_values('week').game_id.tolist()
        recent_ids = team_ids[-4:]
        own = hist[hist.season.eq(season)&hist.team.eq(team)]
        clean = hist[~hist.partial]
        own_clean = own[~own.partial]
        if wl['clean_games']:
            recent = clean_window(own_clean, wl['window'], wl['decay'])
            evidence_games = len(own_clean)
        elif default_workload:
            recent = weighted_window(own, recent_ids)
            evidence_games = len(team_ids)
        else:
            ctx = wl['context'] and {**wl['context'], 'team': team}
            volume, evidence_games = player_window(own, team_ids, identity.position, {**wl, 'context': ctx})
            recent = {**weighted_window(own, recent_ids), **volume}
        old = (clean if wl['clean_games'] else hist)
        old = old[old.season.eq(season-1)]
        if recent is None:
            # Every current-season game was cut short: rely on last season (clean games only).
            if not len(old):
                continue
            recent = old.tail(8)[STATS].mean().to_dict()
        if sum(recent[k] for k in ('attempts','carries','targets')) <= 0:
            continue
        if len(old):
            # Retain all own observed teams; do not assign a former team's games to a new team.
            # Player appearance mean avoids assuming a missing row was a healthy zero-workload game.
            prior = old.tail(8)[STATS].mean().to_dict()
            if wl['role_prior'] and len(own_clean):
                # Last season's volume counts only at this season's playing-time level (a starter
                # last year who is a backup now does not keep a starter's share of team volume).
                now = np.nanmean([shares.get(k, np.nan) for k in zip(own_clean.season, own_clean.week, own_clean.player_id)] or [np.nan])
                then = np.nanmean([shares.get(k, np.nan) for k in zip(old.tail(8).season, old.tail(8).week, old.tail(8).player_id)] or [np.nan])
                if np.isfinite(now) and np.isfinite(then) and then > 0 and now < then:
                    for key in VOLUME:
                        prior[key] *= now/then
            changed_team = old.iloc[-1].team != team
            key = 'changed_team_prior_games' if changed_team else 'prior_games'
            strength = wl[key] if wl[key] is not None else CONFIG['changed_team_prior_games' if changed_team else 'player_prior_games']
            strength *= min(1.,len(old)/8)
        else:
            prior, strength, changed_team = recent.copy(), 0., False
        # Count scheduled games of evidence (including no-usage observations), not a p-value.
        n = evidence_games
        weight = n/(n+strength)
        base = recent.copy()
        for key in ('attempts','carries','targets'):
            base[key] = weight*recent[key]+(1-weight)*prior[key]
        # Optional externally estimated volume (e.g. role-share blend), per player id.
        for key, value in ((wl['volume_override'] or {}).get(identity.player_id) or {}).items():
            base[key] = value
        eff = clean if wl['clean_games'] else hist
        player_totals = eff.tail(8)[STATS].sum()
        positional = pos_totals.loc[identity.position]
        for _, (num, den, pseudo_n) in RATES.items():
            rate = (player_totals[num]+pseudo_n*positional[num]/max(1.,positional[den]))/(player_totals[den]+pseudo_n)
            base[num] = base[den]*rate
        # Rare scoring events use a substantial historical rate prior, not two-game repeats.
        for key in ('fumbles_lost_total','passing_2pt_conversions','rushing_2pt_conversions',
                    'receiving_2pt_conversions','special_teams_tds','fumble_recovery_tds'):
            own_recent = eff.tail(8)
            pos_games = history[history.season.ge(season-1)&history.position.eq(identity.position)]
            base[key] = float((own_recent[key].sum()+20*pos_games[key].mean())/(len(own_recent)+20))
        players.append(dict(id=identity.player_id, name=identity.player_display_name,
            position=identity.position, team=team, lastObservedWeek=int(own.week.max()), base=base,
            missedLastTeamGame=bool(team_ids) and int(own.week.max()) < int(prior_schedule[prior_schedule.game_id.eq(team_ids[-1])].week.iloc[0]),
            workloadEvidence=dict(recentGames=len(recent_ids), currentSeasonGames=n, recentWeight=weight, priorEquivalentGames=strength,
                priorAvailable=bool(len(old)), changedTeam=bool(changed_team),
                recentCarries=recent['carries'], priorCarries=prior['carries'],
                recentTargets=recent['targets'], priorTargets=prior['targets']), future=future))
    if qb1:
        # Starter of each team's most recent game (most pass attempts). Depth charts can lag, so a QB
        # keeps his volume if he started last week even when the chart lists someone else.
        last_starter, streak = {}, {}
        for team in team_forecasts:
            ids = prior_schedule[prior_schedule.season.eq(season)&prior_schedule.team.eq(team)].sort_values('week').game_id.tolist()
            starters = []
            for gid in ids:
                g = history[history.game_id.eq(gid)&history.team.eq(team)&history.position.eq('QB')]
                starters.append(g.loc[g.attempts.idxmax(), 'player_id'] if len(g) and g.attempts.max() > 0 else None)
            if starters and starters[-1]:
                last_starter[team] = starters[-1]
                n = 0
                for x in reversed(starters):
                    if x != starters[-1]:
                        break
                    n += 1
                streak[team] = n
        # ...unless the chart's QB1 is returning from injury (his last game was cut short, or he was on
        # the injury report for the game he then missed): then last week's starter was the fill-in.
        returning = set()
        if playing is not None:
            pl = playing[(playing.season.lt(season)) | (playing.season.eq(season)&playing.week.lt(cutoff_week))]
            last_rows = pl.sort_values(['season','week']).groupby('player_id').tail(1).set_index('player_id')
            for team, starter in qb1.items():
                if starter in last_rows.index and last_starter.get(team) not in (None, starter):
                    r = last_rows.loc[starter]
                    injured_then = bool(r.reported_next) or (int(r.season), int(r.week), starter) in partial
                    # Only a cleared starter is "back": no designation for this week's game.
                    cleared = (season, cutoff_week, starter) not in playing.attrs.get('reports', set())
                    if injured_then and cleared:
                        returning.add(team)
        for p in players:
            starter = qb1.get(p['team'])
            # A fill-in with 3+ straight starts has the job, whatever the chart says.
            keeps_job = last_starter.get(p['team']) == p['id'] and (
                p['team'] not in returning or streak.get(p['team'], 0) >= 3)
            if p['position'] == 'QB' and starter and p['id'] != starter and not keeps_job:
                for key in VOLUME:
                    p['base'][key] = 0.
                for num in [num for num, den, _ in RATES.values()]:
                    p['base'][num] = 0.
                p['workloadEvidence']['notDepthChartStarter'] = True
    # Reconcile candidate opportunity totals downward to independently estimated team totals.
    # Missing candidates do not cause artificial increases in covered players' workloads.
    def reconcile():
        for team in team_forecasts:
            members = [p for p in players if p['team']==team]
            for key in ('attempts','carries','targets'):
                # Optionally, players who sat out the team's last game don't use up team volume.
                active = [p for p in members if not (wl['reconcile_active_only'] and p['missedLastTeamGame'])
                          and p['id'] not in (unavailable or ())]
                total = sum(p['base'][key] for p in active)
                cap = team_forecasts[team]['attempts' if key=='targets' else key]
                factor = min(1.,cap/total) if total > 0 else 1.
                related = [num for num,den,_ in RATES.values() if den==key]
                for p in members:
                    p['base'][key] *= factor
                    for num in related:
                        p['base'][num] *= factor
    reconcile()
    # Role blend (Phase B fix 2): after team reconciliation, blend each WR/TE/RB's targets and
    # carries with his recent snap-share role; dependent yards, catches and TDs scale with them.
    blend_cfg = wl['role_blend'] or CONFIG.get('role_blend')
    if roles is not None and blend_cfg:
        inputs = role_inputs(stats, roles, season, cutoff_week, blend_cfg['position_rates'], blend_cfg['pseudo_snaps'],
                             exclude=partial)
        for p in players:
            info = inputs.get(p['id'])
            if not info or info['position'] != p['position'] or info['team'] != p['team']:
                continue
            evidence = {'snapShareLast2': round(info['snapShareLast2'], 4)}
            for key in ('targets', 'carries'):
                weights = blend_cfg['weights'].get(f"{p['position']} {key}")
                if not weights or key not in info or p['base'][key] <= 0:
                    continue
                old = p['base'][key]
                new = blend(old, info[key], weights)
                p['base'][key] = new
                for num in [num for num, den, _ in RATES.values() if den == key]:
                    p['base'][num] *= new/old
                evidence[key] = {'model': round(old, 3), 'last2': round(info[key]['last2'], 3),
                                 'role': round(info[key]['role'], 3), 'blended': round(new, 3)}
            p['workloadEvidence']['roleBlend'] = evidence
        # Blended volumes still cannot exceed the team's projected totals.
        reconcile()
    output = []
    for p in players:
        games = []
        for game in p.pop('future').itertuples():
            if not include_ros and game.week!=cutoff_week:
                continue
            adjusted, factors = apply_matchup(p['base'],game.opponent,p['position'],defenses,game.week-cutoff_week)
            if wl['implied'] and lines and game.week == cutoff_week:
                # Weekly only: scale scoring output by the team's betting-implied points vs a 22-point average.
                implied = lines.get((game.game_id, p['team']), (0., 22.))[1]
                if implied == implied:
                    k = wl['implied'].get(p['position'], 0.)
                    f = float(np.clip(1+k*(implied-22.), .8, 1.25))
                    for key in ('passing_yards','passing_tds','rushing_yards','rushing_tds','receptions',
                                'receiving_yards','receiving_tds','completions','targets','carries','attempts'):
                        adjusted[key] *= f
                    factors = {**factors, 'implied': {'points': implied, 'factor': f}}
            games.append(dict(week=int(game.week),opponent=game.opponent,stats=adjusted,
                full=score(adjusted),half=score(adjusted,.5),defense=factors))
        current_game = next((g for g in games if g['week']==cutoff_week),None)
        if not games:
            continue
        p.update(games=games, week=current_game, rosFull=sum(g['full'] for g in games),
                 rosHalf=sum(g['half'] for g in games), remainingGames=len(games))
        output.append(p)
    return output


def read_inputs(data_dir, years):
    frames = []
    for year in years:
        f = pd.read_csv(Path(data_dir)/f'stats_player_week_{year}.csv',low_memory=False)
        f = f[f.season_type.eq('REG')&f.position.isin(POSITIONS)].copy()
        missing = set(STATS+['opponent_team'])-set(f.columns)
        if missing:
            raise ValueError(f'Missing input fields: {missing}')
        f[STATS] = f[STATS].apply(pd.to_numeric,errors='raise').fillna(0.)
        if f.duplicated(['season','week','player_id']).any():
            raise ValueError('Duplicate player/week observations')
        frames.append(f)
    return pd.concat(frames,ignore_index=True), schedule_rows(pd.read_csv(Path(data_dir)/'games.csv'))
