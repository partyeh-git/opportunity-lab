/**
 * Tiers: groups of players with similar projections, split where the gaps are biggest.
 *
 * Uses optimal one-dimensional clustering (Jenks natural breaks): for a given number of
 * tiers it finds the split points that make each tier as tight as possible. The number of
 * tiers is the smallest count that explains `fit` of the spread in the values, so a board
 * with a few big drop-offs gets few tiers and a smooth board gets more.
 */
export function tierValues(values: number[], fit = 0.97, maxTiers = 14, minTiers = 1): number[] {
  const n = values.length;
  if (n === 0) return [];
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const sorted = order.map(([v]) => v);
  // Prefix sums give the squared error of any contiguous run in O(1).
  const sum = [0];
  const sq = [0];
  for (const v of sorted) {
    sum.push(sum[sum.length - 1]! + v);
    sq.push(sq[sq.length - 1]! + v * v);
  }
  const sse = (i: number, j: number) => {
    const s = sum[j + 1]! - sum[i]!;
    return sq[j + 1]! - sq[i]! - (s * s) / (j - i + 1);
  };
  const total = sse(0, n - 1);
  const kMax = Math.min(maxTiers, n);
  // cost[k][j]: best error splitting the first j+1 values into k+1 tiers; from[k][j]: last split.
  const cost: number[][] = [sorted.map((_, j) => sse(0, j))];
  const from: number[][] = [sorted.map(() => 0)];
  let tiers = 1;
  while (
    tiers < kMax &&
    total > 0 &&
    (tiers < minTiers || 1 - cost[tiers - 1]![n - 1]! / total < fit)
  ) {
    const k = tiers;
    const row: number[] = Array(n).fill(Infinity);
    const back: number[] = Array(n).fill(0);
    for (let j = k; j < n; j++) {
      for (let i = k; i <= j; i++) {
        const c = cost[k - 1]![i - 1]! + sse(i, j);
        if (c < row[j]!) {
          row[j] = c;
          back[j] = i;
        }
      }
    }
    cost.push(row);
    from.push(back);
    tiers++;
  }
  // Walk the split points back from the end.
  const tierOfSorted: number[] = Array(n).fill(0);
  let end = n - 1;
  for (let k = tiers - 1; k >= 0; k--) {
    const start = k === 0 ? 0 : from[k]![end]!;
    for (let x = start; x <= end; x++) tierOfSorted[x] = k + 1;
    end = start - 1;
  }
  const result: number[] = Array(n).fill(0);
  order.forEach(([, original], x) => (result[original] = tierOfSorted[x]!));
  return result;
}

/**
 * Tiers for a ranked board. Only the top `depth` players (the ones that matter for
 * lineups) are split, into about one tier per `perTier` players at the natural gaps;
 * everyone below is one last "deep" tier. Returns tier numbers in the input order.
 */
export function boardTiers(values: number[], depth: number, perTier: number): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const top = order.slice(0, depth);
  const k = Math.max(1, Math.round(top.length / perTier));
  const topTiers = tierValues(
    top.map(([v]) => v),
    1,
    k,
    k,
  );
  const deep = Math.max(0, ...topTiers) + 1;
  const result: number[] = Array(values.length).fill(deep);
  top.forEach(([, original], x) => (result[original] = topTiers[x]!));
  return result;
}
