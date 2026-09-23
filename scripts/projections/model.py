"""Past-only, sample-aware workloads and separate position/defense channels.

External rankings are never inputs. Uncertainty weights are not p-values.
"""
from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd

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


def forecast(stats, schedule, season, cutoff_week, include_ros=True):
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
        recent_ids = prior_schedule[prior_schedule.season.eq(season)&prior_schedule.team.eq(team)].sort_values('week').tail(4).game_id.tolist()
        own = hist[hist.season.eq(season)&hist.team.eq(team)]
        recent = weighted_window(own, recent_ids)
        if sum(recent[k] for k in ('attempts','carries','targets')) <= 0:
            continue
        old = hist[hist.season.eq(season-1)]
        if len(old):
            # Retain all own observed teams; do not assign a former team's games to a new team.
            # Player appearance mean avoids assuming a missing row was a healthy zero-workload game.
            prior = old.tail(8)[STATS].mean().to_dict()
            changed_team = old.iloc[-1].team != team
            strength = CONFIG['changed_team_prior_games'] if changed_team else CONFIG['player_prior_games']
            strength *= min(1.,len(old)/8)
        else:
            prior, strength, changed_team = recent.copy(), 0., False
        # Count scheduled games of evidence (including no-usage observations), not a p-value.
        n = len(prior_schedule[prior_schedule.season.eq(season)&prior_schedule.team.eq(team)])
        weight = n/(n+strength)
        base = recent.copy()
        for key in ('attempts','carries','targets'):
            base[key] = weight*recent[key]+(1-weight)*prior[key]
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
            workloadEvidence=dict(recentGames=len(recent_ids), currentSeasonGames=n, recentWeight=weight, priorEquivalentGames=strength,
                priorAvailable=bool(len(old)), changedTeam=bool(changed_team),
                recentCarries=recent['carries'], priorCarries=prior['carries'],
                recentTargets=recent['targets'], priorTargets=prior['targets']), future=future))
    # Reconcile candidate opportunity totals downward to independently estimated team totals.
    # Missing candidates do not cause artificial increases in covered players' workloads.
    for team in team_forecasts:
        members = [p for p in players if p['team']==team]
        for key in ('attempts','carries','targets'):
            total = sum(p['base'][key] for p in members)
            cap = team_forecasts[team]['attempts' if key=='targets' else key]
            factor = min(1.,cap/total) if total > 0 else 1.
            related = [num for num,den,_ in RATES.values() if den==key]
            for p in members:
                p['base'][key] *= factor
                for num in related:
                    p['base'][num] *= factor
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
