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

Player projections do not yet adjust for the next opponent, injuries, or lineup news. They require observed 2026 opportunities, so some players are absent. The rest-of-season estimate repeats the current weekly rate and does not project each future opponent. DST is projected for Week 3 only. Trade comparisons use these estimates and omit keeper cost, the required drop, and injury uncertainty. Calibrated outcome ranges, FAAB recommendations, and a sourced news feed are not implemented.

Sleeper directory status is not confirmed game-day availability. NFL free agency does not indicate availability in a fantasy league. League username and selection are saved only in the browser; rosters are fetched read-only and kept in memory.

## Data refresh and historical check

`src/data/rankings-current.json` is produced by the separate opportunity model in `work/football-engine`; `src/data/dst-current.json` is produced by `scripts/build_dst_snapshot.py`. The DST script consumes nflverse `stats_player_week_<year>.csv` for the target and preceding year plus the nflverse `games.csv` schedule. It refuses to project a week if the preceding week is incomplete. For the current Week 3 snapshot:

```sh
python scripts/build_dst_snapshot.py --data-dir ../football-engine/data --season 2026 --week 3
python scripts/evaluate_dst.py --data-dir ../football-engine/data --out ../../outputs/rankings-preview/dst-evaluation.json
```

The DST model gives the opponent offense 65% of its sacks, turnovers, points, and yards estimate; defense history supplies 35%. Both sides shrink toward prior-season and league rates. The historical script recomputes features using pregame data only. Historical performance is a diagnostic, not a calibrated confidence interval or a guaranteed outcome. Refresh both snapshots, review coverage and evaluation, and commit them through GitHub for each new week.

## Development workflow

All changes go through the connected GitHub repository. Never use follow-up Lovable build/edit prompts without Aryeh's explicit exception. Keep model progress and experiment reports in the conversation; app explanations should help a user evaluate a player or roster decision.
