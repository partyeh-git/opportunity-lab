# Opportunity Lab

A fantasy-football player research hub. Development progress and model evaluation summaries belong in chat, not on the app landing page.

## Run locally

```sh
bun install
bun run dev
```

## Implemented

- Searchable Sleeper NFL player directory, position/team filters, and player detail dialogs
- Source-reported roster and injury fields, with retrieval time and explicit availability limitations
- Directory cached in the browser for up to 24 hours to avoid repeatedly fetching the large endpoint
- Dark mode by default with a remembered light/dark toggle
- Read-only Sleeper league lookup, scoring settings, roster ownership, and lineup slots
- Week 3 player opportunity estimates and opponent-led DST streaming tiers for the selected league
- Position, FLEX, and SUPERFLEX views that follow the selected league's actual roster slots
- Personal lineup-impact ranking and a modeled trade lineup comparison
- Responsive navigation for player research, start/sit, rankings, projections, leagues, trades, waivers, and news

## Current limits

Player projections blend recent workloads with prior-season player history and apply separate opponent-adjusted defensive efficiency factors for each position's rushing, catching, receiving, passing, touchdowns, and interceptions. Small samples shrink toward historical or neutral rates. Remaining-season totals sum individual scheduled matchups, excluding byes, with defensive effects fading farther into the future. Rankings default to remaining season; Weekly Projections defaults to the current week. Expand a player's explanation to inspect workload weights, defensive channels, and future games.

The parameters remain experimental and are not statistical significance tests. Current injuries, future role changes, routes/snaps, goal-line usage, coaching, weather, and designed runs versus scrambles are not yet modeled. Players need current-season usage; those without prior-season history lack a player-specific workload prior. QB and receiver outcomes are not jointly reconciled. DST is projected for the current week only. Trade comparisons omit keeper cost, required drops, and injury uncertainty. Calibrated outcome ranges, FAAB recommendations, and a sourced news feed are not implemented.

Sleeper directory status is not confirmed game-day availability. NFL free agency does not indicate availability in a fantasy league. League username and selection are saved only in the browser; rosters are fetched read-only and kept in memory.

## Data refresh and historical check

`src/data/rankings-current.json` is produced by the versioned `scripts/projections` model; `src/data/dst-current.json` is produced by `scripts/build_dst_snapshot.py`. Both consume nflverse player-week statistics and games, and reject incomplete preceding weeks. Keep a prior snapshot for stable Sleeper identity mappings. The projection script does not download data, evaluate 2025 outcomes, or use outside rankings. For the current snapshot:

```sh
python scripts/projections/build.py --data-dir ../football-engine/data --identities src/data/rankings-current.json --output src/data/rankings-current.json --season 2026 --week 3
python -m unittest discover -s scripts/projections -p 'test_*.py'
python scripts/projections/evaluate.py --data-dir ../football-engine/data --output ../../outputs/model-revision
python scripts/build_dst_snapshot.py --data-dir ../football-engine/data --season 2026 --week 3
python scripts/evaluate_dst.py --data-dir ../football-engine/data --out ../../outputs/rankings-preview/dst-evaluation.json
```

The DST model gives the opponent offense 65% of its sacks, turnovers, points, and yards estimate; defense history supplies 35%. Both sides shrink toward prior-season and league rates. The historical script recomputes features using pregame data only. Historical performance is a diagnostic, not a calibrated confidence interval or a guaranteed outcome. Refresh both snapshots, review coverage and evaluation, and commit them through GitHub for each new week.

## Development workflow

All changes go through the connected GitHub repository. Never use follow-up Lovable build/edit prompts without Aryeh's explicit exception. Keep model progress and experiment reports in the conversation; app explanations should help a user evaluate a player or roster decision.
