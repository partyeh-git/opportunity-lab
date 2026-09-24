/** Preserve saved relative order; append newly covered players in model order. */
export function reconcileOrder(saved: string[], current: string[]): string[] {
  const valid = new Set(current);
  const kept = [...new Set(saved)].filter((id) => valid.has(id));
  const seen = new Set(kept);
  return [...kept, ...current.filter((id) => !seen.has(id))];
}

/** Move one player to a one-based overall rank; hidden players retain relative order. */
export function moveToRank(order: string[], id: string, rank: number): string[] {
  if (!order.includes(id) || !Number.isFinite(rank)) return order;
  const next = order.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(next.length, Math.trunc(rank) - 1)), 0, id);
  return next;
}

export function parseOrder(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((id) => typeof id === "string") ? value : [];
  } catch {
    return [];
  }
}

export function rankingStorageKey(
  season: number,
  week: number,
  horizon: string,
  leagueId: string,
  settings: Record<string, number>,
  defensesOnly: boolean,
  slot = "",
) {
  const scoring = JSON.stringify(Object.entries(settings).sort(([a], [b]) => a.localeCompare(b)));
  const board = defensesOnly ? "dst" : slot ? `players-${slot}` : "players";
  return `opportunity-ranking-v1:${season}:${horizon === "week" ? week : "ros"}:${leagueId}:${board}:${scoring}`;
}
