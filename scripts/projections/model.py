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
                        reconcile_active_only=False, volume_override=None, role_blend=None)


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


def forecast(stats, schedule, season, cutoff_week, include_ros=True, workload=None, roles=None):
    wl = {**DEFAULT_WORKLOAD, **(workload or {})}
    default_workload = workload is None
    history = stats[(stats.season.lt(season)) | (stats.season.eq(season)&stats.week.lt(cutoff_week))].copy()
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
        if default_workload:
            recent = weighted_window(own, recent_ids)
            evidence_games = len(team_ids)
        else:
            ctx = wl['context'] and {**wl['context'], 'team': team}
            volume, evidence_games = player_window(own, team_ids, identity.position, {**wl, 'context': ctx})
            recent = {**weighted_window(own, recent_ids), **volume}
        if sum(recent[k] for k in ('attempts','carries','targets')) <= 0:
            continue
        old = hist[hist.season.eq(season-1)]
        if len(old):
            # Retain all own observed teams; do not assign a former team's games to a new team.
            # Player appearance mean avoids assuming a missing row was a healthy zero-workload game.
            prior = old.tail(8)[STATS].mean().to_dict()
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
        player_totals = hist.tail(8)[STATS].sum()
        positional = pos_totals.loc[identity.position]
        for _, (num, den, pseudo_n) in RATES.items():
            rate = (player_totals[num]+pseudo_n*positional[num]/max(1.,positional[den]))/(player_totals[den]+pseudo_n)
            base[num] = base[den]*rate
        # Rare scoring events use a substantial historical rate prior, not two-game repeats.
        for key in ('fumbles_lost_total','passing_2pt_conversions','rushing_2pt_conversions',
                    'receiving_2pt_conversions','special_teams_tds','fumble_recovery_tds'):
            own_recent = hist.tail(8)
            pos_games = history[history.season.ge(season-1)&history.position.eq(identity.position)]
            base[key] = float((own_recent[key].sum()+20*pos_games[key].mean())/(len(own_recent)+20))
        players.append(dict(id=identity.player_id, name=identity.player_display_name,
            position=identity.position, team=team, lastObservedWeek=int(own.week.max()), base=base,
            missedLastTeamGame=bool(team_ids) and int(own.week.max()) < int(prior_schedule[prior_schedule.game_id.eq(team_ids[-1])].week.iloc[0]),
            workloadEvidence=dict(recentGames=len(recent_ids), currentSeasonGames=n, recentWeight=weight, priorEquivalentGames=strength,
                priorAvailable=bool(len(old)), changedTeam=bool(changed_team),
                recentCarries=recent['carries'], priorCarries=prior['carries'],
                recentTargets=recent['targets'], priorTargets=prior['targets']), future=future))
    # Reconcile candidate opportunity totals downward to independently estimated team totals.
    # Missing candidates do not cause artificial increases in covered players' workloads.
    def reconcile():
        for team in team_forecasts:
            members = [p for p in players if p['team']==team]
            for key in ('attempts','carries','targets'):
                # Optionally, players who sat out the team's last game don't use up team volume.
                active = [p for p in members if not (wl['reconcile_active_only'] and p['missedLastTeamGame'])]
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
        inputs = role_inputs(stats, roles, season, cutoff_week, blend_cfg['position_rates'], blend_cfg['pseudo_snaps'])
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
