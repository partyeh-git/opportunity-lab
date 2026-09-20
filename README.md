# Opportunity Lab

A private, frontend-only fantasy-football research workspace for transparent model evaluation and future league analysis.

## Run locally

```sh
bun install
bun run dev
```

Open the local URL shown in the terminal.

## Implemented

- Interactive 2023 and 2024 Full PPR backtest results using only the supplied measured values
- Plain-English projection checks: average points missed, modest improvements, worked scoring example, and next steps
- Expandable technical metrics, diagnostic uncertainty ranges, methodology, and limitations
- Dark mode by default, with an accessible light/dark toggle and a saved browser preference
- Browser-only, read-only Sleeper username lookup with explicit season selection
- Designed empty states for weekly projections, trades, waivers/FAAB, and news/roles
- Responsive desktop and mobile workspace

## Not implemented

There is no production projection engine, trade evaluator, FAAB model, news feed, database, paid data, AI integration, or cloud backend. League data is fetched directly from Sleeper's public API and is not persisted.

## Development workflow

Connect this repository to GitHub before making subsequent changes. This initial Lovable design build is the sole allowed build prompt. After it, make all design, UI, data, logic, integration, and bug-fix changes through the connected GitHub repository unless Aryeh explicitly authorizes an exception.

The static experiment data is isolated in `src/data/backtest-results.ts` so a separately reproducible Python projection pipeline can replace it later.
