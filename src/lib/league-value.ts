export type ValuePlayer = { id: string; position: string; points: number };
export type StarterBaseline = { rank: number; points: number; playerId: string };

export const DEFAULT_LINEUP = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF"];

export function eligible(position: string, slot: string) {
  if (["BN", "IR", "TAXI", "RESERVE"].includes(slot)) return false;
  if (slot === position) return true;
  if (slot === "FLEX") return ["RB", "WR", "TE"].includes(position);
  if (slot === "WRRB_FLEX") return ["WR", "RB"].includes(position);
  if (slot === "SUPER_FLEX") return ["QB", "RB", "WR", "TE"].includes(position);
  if (slot === "REC_FLEX") return ["WR", "TE"].includes(position);
  return false;
}

/** Value over last starter (VOLS), not waiver replacement or keeper/trade value.
 * Select the highest-scoring legal league-wide starter pool. Augmenting paths
 * reassign flex occupants so overlapping slots never double-count a player or
 * depend on the input order of slots. Each position's last selected player is
 * its baseline; bench demand is deliberately outside this starter-only model.
 */
export function leagueValues(players: ValuePlayer[], teams: number, lineup: string[]) {
  const sorted = [...players]
    .filter((p) => Number.isFinite(p.points))
    .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  const slots = Array.from({ length: Math.max(0, Math.floor(teams)) }, () => lineup)
    .flat()
    .filter((slot) => sorted.some((p) => eligible(p.position, slot)));
  const occupants: (ValuePlayer | undefined)[] = Array(slots.length).fill(undefined);
  function assign(player: ValuePlayer, visited: Set<number>): boolean {
    for (let i = 0; i < slots.length; i++) {
      if (visited.has(i) || !eligible(player.position, slots[i]!)) continue;
      visited.add(i);
      const current = occupants[i];
      if (!current || assign(current, visited)) {
        occupants[i] = player;
        return true;
      }
    }
    return false;
  }
  for (const player of sorted) assign(player, new Set());
  const selected = new Set(occupants.flatMap((p) => (p ? [p.id] : [])));
  const baselines = new Map<string, StarterBaseline>();
  for (const player of sorted) {
    if (!selected.has(player.id)) continue;
    baselines.set(player.position, {
      rank: (baselines.get(player.position)?.rank ?? 0) + 1,
      points: player.points,
      playerId: player.id,
    });
  }
  const values = new Map(
    sorted.map((p) => {
      const baseline = baselines.get(p.position);
      return [p.id, baseline ? p.points - baseline.points : null] as const;
    }),
  );
  return { values, baselines, filledSlots: selected.size, totalSlots: slots.length };
}
