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

The prospective availability overlay removes confirmed missed games using a reviewed, dated official-source ledger. IR minimum absences count scheduled games, not calendar weeks. Uncertain injury flags and return dates remain conditional on playing; no play probabilities or recovery dates are invented. Source links and review time appear in player explanations. Public status flags without a game week never establish a new absence. The ledger currently supplements a Week 2 injury feed with selected official reports; it is not complete current-week clearance and does not refresh automatically.

For RB/WR/TE absences, carries and targets are adjusted separately. A recipient must have observed same-team, same-position usage during a confirmed teammate absence and no unresolved injury flag. Only the positive difference between that absence-role average and the existing baseline is considered, weighted by n/(n+4) observed games. Missing usage rows in those games count as zero. The total increase cannot exceed the absent players' modeled workload; unused workload stays unallocated. This avoids adding a full vacated workload on top of role changes already present in recent averages. Multiple absences share one cap. A separately confirmed replacement QB receives the existing team passing budget, with his own regressed passing rates, for the confirmed start only; rushing ability is not transferred. These rules are provisional heuristics, not historically validated causal effects.

The parameters remain experimental and are not statistical significance tests. Future role changes beyond these limited absence adjustments, routes/snaps, goal-line usage, coaching, weather, and designed runs versus scrambles are not yet modeled. Players need current-season usage; those without prior-season history lack a player-specific workload prior. QB and receiver outcomes are not jointly reconciled, including the effect of a replacement QB on receivers. DST is projected for the current week only. Trade comparisons omit keeper cost, required drops, and unresolved injury uncertainty. Calibrated outcome ranges, FAAB recommendations, and a sourced news feed are not implemented.

Sleeper directory status is not confirmed game-day availability. NFL free agency does not indicate availability in a fantasy league. League username and selection are saved only in the browser; rosters are fetched read-only and kept in memory.

## Data refresh and historical check

`src/data/rankings-current.json` is produced by the versioned `scripts/projections` model; `src/data/dst-current.json` is produced by `scripts/build_dst_snapshot.py`. Both consume nflverse player-week statistics and games, and reject incomplete preceding weeks. Keep a prior snapshot for stable Sleeper identity mappings. The projection script does not download data, evaluate 2025 outcomes, or use outside rankings. For the current snapshot:

```sh
python scripts/projections/build.py --data-dir ../football-engine/data --identities src/data/rankings-current.json --output src/data/rankings-current.json --season 2026 --week 3 --availability scripts/projections/availability-current.json
python -m unittest discover -s scripts/projections -p 'test_*.py'
python scripts/projections/evaluate.py --data-dir ../football-engine/data --output ../../outputs/model-revision
python scripts/build_dst_snapshot.py --data-dir ../football-engine/data --season 2026 --week 3
python scripts/evaluate_dst.py --data-dir ../football-engine/data --out ../../outputs/rankings-preview/dst-evaluation.json
```

The DST model gives the opponent offense 65% of its sacks, turnovers, points, and yards estimate; defense history supplies 35%. Both sides shrink toward prior-season and league rates. The historical script recomputes features using pregame data only. Historical performance is a diagnostic, not a calibrated confidence interval or a guaranteed outcome. Refresh both snapshots, review coverage and evaluation, and commit them through GitHub for each new week.

### Availability refresh

Fetch the public Sleeper `/v1/players/nfl` directory (respect its 24-hour cache recommendation) and nflverse `injuries_<season>.csv` into a local work directory. Record their actual retrieval time. Review current official team/NFL reports and update `scripts/projections/injury-review.json`, including season/week, publication dates, review time, explicit missed weeks or IR placement week, and links. Do not carry old Out designations into the next week. The minimum four-game IR rule is documented by [NFL](https://www.nfl.com/news/players-now-eligible-to-return-from-injured-reserve-after-four-games); recheck rule changes when refreshing seasons. Return eligibility is not a medical clearance.

Run `prepare_availability.py --snapshot src/data/rankings-current.json --sleeper <raw-directory.json> --injuries <raw-injuries.csv> --games <games.csv> --review scripts/projections/injury-review.json --fetched-at <ISO-retrieval-time> --output scripts/projections/availability-current.json`, then rebuild. The build rejects a different season/week, future evidence, and reviews older than 48 hours. `--as-of` is for reproducing a frozen snapshot, not for bypassing stale evidence on a new publication. Raw public source hashes are retained; no fantasy rankings enter the model.

The historical evaluator calls the base model directly and does **not** load this current-news overlay. The previous historical results therefore do not validate the injury redistribution. Historical testing needs genuine as-of injury/roster archives and expanded backup-player coverage first.

## Development workflow

All changes go through the connected GitHub repository. Never use follow-up Lovable build/edit prompts without Aryeh's explicit exception. Keep model progress and experiment reports in the conversation; app explanations should help a user evaluate a player or roster decision.
