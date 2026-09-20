# Opportunity Lab

A private, frontend-only fantasy-football research workspace for transparent model evaluation and future league analysis.

## Run locally

```sh
bun install
bun run dev
```

Open the local URL shown in the terminal.

## Implemented

- Interactive 2023 and 2024 Full PPR backtest results using the supplied measured values
- Model comparison table, MAE chart, bootstrap intervals, methodology, and limitations
- Browser-only, read-only Sleeper username lookup with explicit season selection
- Designed empty states for weekly projections, trades, waivers/FAAB, and news/roles
- Responsive desktop and mobile workspace

## Not implemented

There is no production projection engine, trade evaluator, FAAB model, news feed, database, paid data, AI integration, or cloud backend. League data is fetched directly from Sleeper's public API and is not persisted.

## Development workflow

This repository must be connected to GitHub before any subsequent changes. The initial Lovable design build is the sole allowed build prompt. After this initial design, make all design, UI, data, logic, integration, and bug-fix changes through the connected GitHub repository unless Aryeh explicitly authorizes an exception.

The static experiment data is isolated in `src/data/backtest-results.ts` so a separately reproducible Python projection pipeline can replace it later.
