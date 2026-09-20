export type Season = "2023" | "2024";
export type ModelKey = "recent" | "opportunity" | "matchup";
export type ModelResult = { key: ModelKey; label: string; shortLabel: string; mae: number; rmse: number; bias: number; description: string };
export type Improvement = { comparison: string; value: number; low: number; high: number; clear: boolean };
export type SeasonResult = { season: Season; sampleSize: number; models: readonly ModelResult[]; improvements: readonly Improvement[] };

export const EXPERIMENT = {
  scoring: "Full PPR · 4-point passing TD · −2 interceptions",
  window: "Weeks 5–18",
  cohort: "Primary cohort selected before outcomes · recent-form projection ≥ 5",
  results: {
    "2023": { season: "2023", sampleSize: 2499, models: [
      { key: "recent", label: "Recent form", shortLabel: "Recent", mae: 6.418220, rmse: 8.138770, bias: 1.261795, description: "Weighted recent production baseline" },
      { key: "opportunity", label: "Opportunity", shortLabel: "Opportunity", mae: 6.141348, rmse: 7.757632, bias: 0.892336, description: "Same weighted volume, stabilized efficiency" },
      { key: "matchup", label: "Matchup", shortLabel: "Matchup", mae: 6.132653, rmse: 7.744381, bias: 0.865579, description: "Opportunity model plus initial matchup adjustment" },
    ], improvements: [
      { comparison: "Recent → Opportunity", value: 0.276872, low: 0.200463, high: 0.353729, clear: true },
      { comparison: "Opportunity → Matchup", value: 0.008695, low: -0.017496, high: 0.032701, clear: false },
    ] },
    "2024": { season: "2024", sampleSize: 2515, models: [
      { key: "recent", label: "Recent form", shortLabel: "Recent", mae: 6.565735, rmse: 8.253265, bias: 1.159890, description: "Weighted recent production baseline" },
      { key: "opportunity", label: "Opportunity", shortLabel: "Opportunity", mae: 6.360138, rmse: 8.020512, bias: 0.610036, description: "Same weighted volume, stabilized efficiency" },
      { key: "matchup", label: "Matchup", shortLabel: "Matchup", mae: 6.366719, rmse: 8.023511, bias: 0.629421, description: "Opportunity model plus initial matchup adjustment" },
    ], improvements: [
      { comparison: "Recent → Opportunity", value: 0.205597, low: 0.129589, high: 0.273496, clear: true },
      { comparison: "Opportunity → Matchup", value: -0.006582, low: -0.020266, high: 0.009219, clear: false },
    ] },
  } satisfies Record<Season, SeasonResult>,
} as const;
