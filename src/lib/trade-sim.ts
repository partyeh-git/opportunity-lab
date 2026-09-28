import { eligible } from "./league-value";

export type SimPlayer = {
  id: string;
  name: string;
  position: string;
  /** Projected points by NFL week; a missing week is a bye. */
  weekly: Map<number, number>;
};

/** Best legal lineup for one week, and who is in it. */
export function bestLineup(
  players: { id: string; position: string; points: number }[],
  slots: string[],
) {
  const n = slots.length;
  const size = 1 << n;
  const usable = players.filter((p) => p.points > 0);
  // stages[i][mask]: best total using the first i players to fill exactly the slots in mask.
  const stages: Float64Array[] = [new Float64Array(size).fill(Number.NEGATIVE_INFINITY)];
  stages[0]![0] = 0;
  const used: Int8Array[] = [];
  usable.forEach((player, i) => {
    const prev = stages[i]!;
    const next = Float64Array.from(prev);
    const slotUsed = new Int8Array(size).fill(-1);
    for (let mask = 0; mask < size; mask++) {
      if (!Number.isFinite(prev[mask])) continue;
      for (let slot = 0; slot < n; slot++) {
        if (mask & (1 << slot) || !eligible(player.position, slots[slot]!)) continue;
        const filled = mask | (1 << slot);
        if (prev[mask]! + player.points > next[filled]!) {
          next[filled] = prev[mask]! + player.points;
          slotUsed[filled] = slot;
        }
      }
    }
    stages.push(next);
    used.push(slotUsed);
  });
  const last = stages[usable.length]!;
  let mask = 0;
  for (let m = 1; m < size; m++) if (last[m]! > last[mask]!) mask = m;
  const total = last[mask]!;
  const starters: string[] = [];
  for (let i = usable.length - 1; i >= 0; i--) {
    // The player is in the lineup when adding him is what produced this stage's best.
    if (stages[i + 1]![mask] !== stages[i]![mask] && used[i]![mask]! >= 0) {
      starters.push(usable[i]!.id);
      mask &= ~(1 << used[i]![mask]!);
    }
  }
  return { total, starters };
}

/**
 * Plays out the rest of the season one week at a time: each week the roster fields its best
 * lineup from that week's projections, so byes, ruled-out weeks and bench depth all count.
 */
export function simulateSeason(roster: SimPlayer[], slots: string[], weeks: number[]) {
  const starts = new Map<string, { weeks: number; points: number }>();
  let total = 0;
  for (const week of weeks) {
    const lineup = bestLineup(
      roster.map((p) => ({ id: p.id, position: p.position, points: p.weekly.get(week) ?? 0 })),
      slots,
    );
    total += lineup.total;
    for (const id of lineup.starters) {
      const row = starts.get(id) ?? { weeks: 0, points: 0 };
      row.weeks += 1;
      row.points += roster.find((p) => p.id === id)!.weekly.get(week) ?? 0;
      starts.set(id, row);
    }
  }
  return { total, starts };
}

/** Points a week that count as a real change to a lineup; smaller is noise. */
export const REAL_CHANGE = 0.5;

/** Plain verdict from each side's lineup change, in points per week. */
export function tradeVerdict(mine: number, theirs: number | null) {
  const up = (v: number) => v >= REAL_CHANGE;
  const down = (v: number) => v <= -REAL_CHANGE;
  const headline = up(mine)
    ? theirs !== null && up(theirs)
      ? "Good for both teams"
      : "You win this trade"
    : down(mine)
      ? theirs !== null && up(theirs)
        ? "They win this trade"
        : theirs !== null && down(theirs)
          ? "Bad for both teams"
          : "Bad trade for you"
      : theirs !== null && up(theirs)
        ? "Helps them, not you"
        : "No real change for you";
  // Fair or lopsided only means something when somebody comes out ahead.
  if (theirs === null || (!up(mine) && !up(theirs))) return { headline, fairness: "" };
  const gap = mine - theirs;
  const side = gap > 0 ? "your way" : "their way";
  const fairness =
    up(mine) && up(theirs) && Math.abs(gap) < 1
      ? "Fair"
      : Math.abs(gap) < 1
        ? "Even"
        : Math.abs(gap) < 3
          ? `Tilted ${side}`
          : `Lopsided ${side}`;
  return { headline, fairness };
}
