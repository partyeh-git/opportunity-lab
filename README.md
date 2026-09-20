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
- Read-only Sleeper league lookup with season selection
- Responsive navigation for player research, start/sit, rankings, projections, leagues, trades, waivers, and news

## Not implemented

Current projections, calibrated outcome ranges, rankings, start/sit advice, league roster ownership, trade valuation, FAAB recommendations, and a sourced news feed are not connected. Their screens explicitly show unavailable states. No invented player forecasts are displayed.

Sleeper directory status is not confirmed game-day availability. NFL free agency does not indicate availability in a fantasy league. League lookup is browser-only and not persisted; the public player directory is cached locally.

## Development workflow

All changes go through the connected GitHub repository. Never use follow-up Lovable build/edit prompts without Aryeh's explicit exception. Keep model progress and experiment reports in the conversation; app explanations should help a user evaluate a player or roster decision.
