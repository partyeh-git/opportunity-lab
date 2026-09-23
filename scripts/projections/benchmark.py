"""Frozen opportunity_v0 comparison from the existing engine; never tuned here."""
import numpy as np
import pandas as pd

POSITIONS = ('QB', 'RB', 'WR', 'TE')

STATS = ['attempts', 'completions', 'passing_yards', 'passing_tds', 'passing_interceptions',
         'carries', 'rushing_yards', 'rushing_tds', 'targets', 'receptions', 'receiving_yards',
         'receiving_tds', 'fumbles_lost_total', 'passing_2pt_conversions',
         'rushing_2pt_conversions', 'receiving_2pt_conversions', 'special_teams_tds', 'fumble_recovery_tds']

RATE_SPECS = {
    'catch': ('receptions', 'targets', 20),
    'rec_yards': ('receiving_yards', 'receptions', 20),
    'rec_td': ('receiving_tds', 'targets', 100),
    'rush_yards': ('rushing_yards', 'carries', 30),
    'rush_td': ('rushing_tds', 'carries', 100),
    'pass_yards': ('passing_yards', 'attempts', 100),
    'pass_td': ('passing_tds', 'attempts', 150),
    'pass_int': ('passing_interceptions', 'attempts', 100),
}

def score(stats, ppr=1.0, interception=-2.0):
    get = lambda name: stats.get(name, 0.0)
    return (0.04 * get('passing_yards') + 0.1 * (get('rushing_yards') + get('receiving_yards'))
            + 4 * get('passing_tds') + 6 * (get('rushing_tds') + get('receiving_tds')
            + get('special_teams_tds') + get('fumble_recovery_tds'))
            + ppr * get('receptions') + interception * get('passing_interceptions')
            - 2 * get('fumbles_lost_total') + 2 * (get('passing_2pt_conversions')
            + get('rushing_2pt_conversions') + get('receiving_2pt_conversions')))

def adjusted_factor(state, defense, position, channel):
    observed, expected, volume = state.get((defense, position, channel), (0.0, 0.0, 0.0))
    strength = {'catch': 100, 'receiving': 100, 'rushing': 150, 'passing': 250}[channel]
    if expected <= 0 or volume <= 0:
        return 1.0
    ratio = observed / expected
    return float(np.clip(1 + (ratio - 1) * volume / (volume + strength), 0.85, 1.15))

def forecast_week(stats, schedule, season, week, defense_state):
    # This cutoff is the central leakage boundary. Outcomes are joined only after return.
    history = stats[(stats.season < season) | ((stats.season == season) & (stats.week < week))]
    current = history[history.season.eq(season)]
    if current.empty:
        return []
    fixtures = schedule[(schedule.season == season) & (schedule.week == week)]
    recent_schedules = schedule[(schedule.season == season) & (schedule.week < week)]
    last_games = {team: rows.sort_values('week').tail(4).game_id.tolist()
                  for team, rows in recent_schedules.groupby('team')}
    fixture_map = {row.team: row for row in fixtures.itertuples()}
    player_histories = {pid: frame for pid, frame in history.groupby('player_id', sort=False)}
    current_team_stats = current.groupby(['team', 'game_id'])[STATS].sum()
    prior = history[history.season >= season - 1].groupby('position')[STATS].sum()
    recent_players = current.sort_values('week').groupby('player_id', sort=False).tail(1)
    predictions = []
    for identity in recent_players.itertuples():
        team = identity.team
        if team not in fixture_map or team not in last_games:
            continue
        game_ids = last_games[team]
        hist = player_histories[identity.player_id]
        own = hist[(hist.season == season) & hist.team.eq(team)]
        window = own.set_index('game_id')[STATS].reindex(game_ids).fillna(0.0)
        if window[['attempts', 'carries', 'targets']].to_numpy().sum() <= 0:
            continue
        weights = np.array([0.8 ** i for i in range(len(game_ids)-1, -1, -1)])
        weights /= weights.sum()
        recent = dict(zip(STATS, weights @ window.to_numpy()))
        team_window = current_team_stats.loc[team].reindex(game_ids).fillna(0.0)
        team_avg = dict(zip(STATS, weights @ team_window.to_numpy()))
        # Allocation is explicit. With the same observation window the allocations
        # intentionally equal the recent weighted volume; this experiment tests
        # shrunk efficiency before adding a separate offensive pace/trend model.
        opportunities = {}
        for stat, denominator in [('attempts','attempts'), ('carries','carries'), ('targets','targets')]:
            share = recent[stat] / team_avg[denominator] if team_avg[denominator] else 0.0
            opportunities[stat] = team_avg[denominator] * share
        player_totals = hist.tail(8)[STATS].sum()
        position_totals = prior.loc[identity.position]
        rates = {}
        for key, (numerator, denominator, strength) in RATE_SPECS.items():
            base_rate = float(position_totals[numerator] / max(position_totals[denominator], 1))
            rates[key] = float((player_totals[numerator] + strength * base_rate) /
                               (player_totals[denominator] + strength))
        opportunity = recent.copy()
        opportunity.update(opportunities)
        opportunity['receptions'] = opportunities['targets'] * rates['catch']
        opportunity['receiving_yards'] = opportunity['receptions'] * rates['rec_yards']
        opportunity['receiving_tds'] = opportunities['targets'] * rates['rec_td']
        opportunity['rushing_yards'] = opportunities['carries'] * rates['rush_yards']
        opportunity['rushing_tds'] = opportunities['carries'] * rates['rush_td']
        opportunity['passing_yards'] = opportunities['attempts'] * rates['pass_yards']
        opportunity['passing_tds'] = opportunities['attempts'] * rates['pass_td']
        opportunity['passing_interceptions'] = opportunities['attempts'] * rates['pass_int']
        opponent = fixture_map[team].opponent
        factors = {channel: adjusted_factor(defense_state, opponent, identity.position, channel)
                   for channel in ('catch', 'receiving', 'rushing', 'passing')}
        matchup = opportunity.copy()
        matchup['receptions'] = min(opportunities['targets'], opportunity['receptions'] * factors['catch'])
        # Receiving factor estimates yards per target and already incorporates catches.
        matchup['receiving_yards'] *= factors['receiving']
        matchup['rushing_yards'] *= factors['rushing']
        matchup['passing_yards'] *= factors['passing']
        predictions.append(dict(season=season, week=week, game_id=fixture_map[team].game_id,
                                player_id=identity.player_id, player_name=identity.player_display_name,
                                position=identity.position, team=team, opponent=opponent,
                                primary_cohort=score(recent) >= 5,
                                history_last_week=int(own.week.max()), rates=rates, factors=factors,
                                models={'recent_form_v0': recent, 'opportunity_v0': opportunity, 'matchup_v0': matchup}))
    return predictions