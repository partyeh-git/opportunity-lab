/**
 * How often the player we project higher actually outscores the other, by the size of the gap.
 * Current model, same-week pairs of startable players (6+ projected points), same position or
 * flex-eligible, 2019-2023 (1.6M pairs). Held up on 2024 (52/55/57/62/67/72%) and 2025
 * (52/56/59/63/68/75%). Script: work/startsit/gap_winrate.py.
 */
const CALLS = [
  { under: 1, rate: 0.52, call: "Coin flip" },
  { under: 2, rate: 0.56, call: "Slight lean" },
  { under: 3, rate: 0.59, call: "Lean" },
  { under: 5, rate: 0.63, call: "Solid edge" },
  { under: 8, rate: 0.68, call: "Clear start" },
  { under: Infinity, rate: 0.74, call: "Strong start" },
] as const;

export function startSitCall(gap: number) {
  return CALLS.find((row) => Math.abs(gap) < row.under)!;
}
