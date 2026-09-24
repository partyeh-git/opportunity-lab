"""Prospective availability overlay. No inferred play probabilities or return dates.

Source observations are frozen with the snapshot, not backfilled into evaluations.
Teammate adjustments are experimental, bounded allocations of existing workload.
"""
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path

from model import RATES, STATS, score


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Evidence timestamps must include timezone')
    return result


def load_evidence(path, season, week, as_of):
    evidence = json.loads(Path(path).read_text(encoding='utf-8'))
    if (evidence['season'], evidence['week']) != (season, week):
        raise ValueError('Availability evidence belongs to another season/week')
    now, reviewed = timestamp(as_of), timestamp(evidence['reviewedAt'])
    if not 0 <= (now-reviewed).total_seconds() <= 48*3600:
        raise ValueError('Availability review is future-dated or older than 48 hours; refresh it')
    ids = set()
    for record in evidence['players']:
        if record['id'] in ids:
            raise ValueError('Duplicate availability identity')
        ids.add(record['id'])
        for s in record['sources']:
            if timestamp(s['retrievedAt']) > now:
                raise ValueError('Future evidence cannot be used')
            if s.get('publishedDate') and s['publishedDate'] > now.date().isoformat():
                raise ValueError('Future publication cannot be used')
        weeks = record.get('outWeeks', [])
        if any(type(w) is not int or not 1 <= w <= 18 for w in weeks):
            raise ValueError('Invalid absence week')
        # IR/PUP/suspension roster status (NFL transactions, via Sleeper) establishes the current week only.
        if weeks and not any(s['kind'] in ('official', 'roster_status') for s in record['sources']):
            raise ValueError('Confirmed absence requires reviewed official evidence or an IR/PUP/suspension roster status')
        if not set(record.get('replacementWeeks', [])).issubset(weeks):
            raise ValueError('Replacement start must fall within confirmed absence weeks')
    return evidence


def rescale(stats, key, value):
    """Keep the recipient's rates, including existing matchup effects."""
    old = stats[key]
    if old <= 0 and value > 0:
        raise ValueError('Cannot create an efficiency estimate without a baseline')
    factor = value/old if old else 0.
    stats[key] = value
    related = [num for num, den, _ in RATES.values() if den == key]
    related += {'attempts': ['completions', 'passing_2pt_conversions'],
                'carries': ['rushing_2pt_conversions'],
                'targets': ['receiving_2pt_conversions']}[key]
    for num in set(related):
        stats[num] *= factor


def apply_availability(projections, stats, evidence, season, week):
    players = deepcopy(projections)
    records = {r['id']: r for r in evidence['players']}
    history = stats[stats.season.eq(season) & stats.week.lt(week)]
    lookup = {p['id']: p for p in players}
    for record in records.values():
        if record['id'] in lookup and record['team'] != lookup[record['id']]['team']:
            raise ValueError('Availability team does not match modeled team')
    for p in players:
        r = records.get(p['id'], {})
        out = r.get('outWeeks', [])
        p['availability'] = dict(
            state='confirmed_out' if week in out else 'uncertain' if r else 'unverified',
            label='Confirmed out' if week in out else 'If active · status unresolved' if r else 'Availability not confirmed',
            reportedStatus=r.get('reportedStatus', ''), injury=r.get('injury', ''),
            outWeeks=out, note=r.get('note', 'No confirmed game-day availability in this snapshot.'),
            sources=r.get('sources', []), reviewedAt=evidence['reviewedAt'])
        p['roleAdjustments'] = []
        for g in p['games']:
            g['ifActiveStats'] = g['stats'].copy()
            g['availability'] = 'out' if g['week'] in out else 'if_active'
            if g['week'] in out:
                g['stats'] = dict.fromkeys(STATS, 0.)

    allocations = []
    # Group donors to prevent several absences exceeding a recipient's single cap.
    for team in sorted({p['team'] for p in players}):
        members = [p for p in players if p['team'] == team]
        weeks = sorted({g['week'] for p in members for g in p['games']})
        for future_week in weeks:
            games = {p['id']: next(g for g in p['games'] if g['week'] == future_week) for p in members}
            for position in ('RB', 'WR', 'TE'):
                donors = [p for p in members if p['position'] == position and games[p['id']]['availability'] == 'out']
                if not donors:
                    continue
                for key in ('carries', 'targets'):
                    pool = sum(games[p['id']]['ifActiveStats'][key] for p in donors)
                    requests = []
                    for p in members:
                        if p['position'] != position or games[p['id']]['availability'] == 'out':
                            continue
                        r = records.get(p['id'], {})
                        # Unresolved current injuries do not earn automatic workload increases.
                        if r and not r.get('outWeeks'):
                            continue
                        if r.get('outWeeks'):
                            continue  # Return is unconfirmed even after the minimum absence.
                        own = history[history.player_id.eq(p['id']) & history.team.eq(team)].tail(4)
                        if own.empty or own[key].sum() <= 0:
                            continue
                        # Require actual observations while at least one donor was absent.
                        absent_weeks = set().union(*(set(records[d['id']]['outWeeks']) for d in donors))
                        team_weeks = sorted(history[history.team.eq(team)].week.unique())[-4:]
                        observed_weeks = [w for w in team_weeks if w in absent_weeks]
                        if not observed_weeks:
                            continue
                        observed = own.set_index('week').reindex(observed_weeks).fillna(0.)
                        base = games[p['id']]['stats'][key]
                        # Move toward observed absence-role workload, not above it. Baseline
                        # already contains some of that role: only the remaining delta is used.
                        n = len(observed)
                        target = float(observed[key].mean())
                        delta = max(0., target-base)*n/(n+4.)
                        if delta > 0 and base > 0:
                            requests.append((p, delta, n, target))
                    requested = sum(item[1] for item in requests)
                    factor = min(1., pool/requested) if requested else 0.
                    allocated = 0.
                    for p, delta, n, target in requests:
                        amount = delta*factor
                        if amount <= 0:
                            continue
                        g = games[p['id']]
                        rescale(g['stats'], key, g['stats'][key]+amount)
                        allocated += amount
                        p['roleAdjustments'].append(dict(week=future_week, opportunity=key,
                            added=amount, absentPlayers=[d['name'] for d in donors],
                            evidenceGames=n, observedWorkload=target,
                            note='Observed same-position usage during confirmed absences; sample-weighted delta above baseline.'))
                    allocations.append(dict(team=team, week=future_week, position=position,
                        opportunity=key, vacated=pool, allocated=allocated, unallocated=pool-allocated))
            # A named replacement QB gets the existing team passing workload for the
            # confirmed start only. Do not transfer the absent QB's rushing ability.
            for donor in members:
                r = records.get(donor['id'], {})
                replacement = r.get('replacementId')
                if donor['position'] != 'QB' or future_week not in r.get('replacementWeeks', []):
                    continue
                recipient = lookup.get(replacement)
                if not recipient or recipient['team'] != team or recipient['position'] != 'QB':
                    raise ValueError('Named replacement quarterback is not covered by the model')
                g = games[replacement]
                if g['availability'] == 'out' or records.get(replacement):
                    raise ValueError('Named replacement availability is conflicting')
                qbs = [p for p in members if p['position'] == 'QB']
                budget = sum(games[p['id']]['ifActiveStats']['attempts'] for p in qbs)
                added = budget-g['stats']['attempts']
                rescale(g['stats'], 'attempts', budget)
                for p in qbs:
                    if p['id'] != replacement:
                        rescale(games[p['id']]['stats'], 'attempts', 0.)
                recipient['roleAdjustments'].append(dict(week=future_week, opportunity='attempts',
                    added=added, absentPlayers=[donor['name']], evidenceGames=0, observedWorkload=budget,
                    note='Officially named starter receives the modeled team passing workload, using his own regressed passing rates. Rushing role is unchanged.'))
                if future_week == week:
                    recipient['availability'].update(state='role_confirmed',label=f'Named starter · Week {week}',
                        note=f'Officially named starter for Week {week}. This is not game-day clearance. Later weeks retain the baseline role because further starts are unconfirmed.',
                        sources=[s for s in r['sources'] if s['kind']=='official'])
    for p in players:
        for g in p['games']:
            g['full'], g['half'] = score(g['stats']), score(g['stats'], .5)
        p['week'] = next((g for g in p['games'] if g['week'] == week), None)
        p['rosFull'] = sum(g['full'] for g in p['games'])
        p['rosHalf'] = sum(g['half'] for g in p['games'])
    return players, allocations
