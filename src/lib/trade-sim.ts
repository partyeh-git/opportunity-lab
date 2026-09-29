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
  const byWeek: number[] = [];
  /** Each week's weakest starter, or 0 when a lineup spot sits empty: the bar a newcomer must beat. */
  const bar: number[] = [];
  let total = 0;
  for (const week of weeks) {
    const lineup = bestLineup(
      roster.map((p) => ({ id: p.id, position: p.position, points: p.weekly.get(week) ?? 0 })),
      slots,
    );
    total += lineup.total;
    byWeek.push(lineup.total);
    bar.push(
      lineup.starters.length < slots.length
        ? 0
        : Math.min(
            ...lineup.starters.map((id) => roster.find((p) => p.id === id)!.weekly.get(week) ?? 0),
          ),
    );
    for (const id of lineup.starters) {
      const player = roster.find((p) => p.id === id)!;
      const points = player.weekly.get(week) ?? 0;
      const row = starts.get(id) ?? { weeks: 0, points: 0 };
      row.weeks += 1;
      row.points += points;
      starts.set(id, row);
    }
  }
  return { total, starts, byWeek, bar };
}

/**
 * Points a roster's lineup gains each week by adding one player. Same answer as playing the
 * season with and without him, but skips the weeks where he cannot beat the weakest starter.
 */
export function gainFromAdding(
  roster: SimPlayer[],
  candidate: SimPlayer,
  slots: string[],
  weeks: number[],
  base: { byWeek: number[]; bar: number[] },
) {
  return weeks.map((week, i) => {
    const points = candidate.weekly.get(week) ?? 0;
    if (points <= base.bar[i]!) return 0;
    const lineup = bestLineup(
      [...roster, candidate].map((p) => ({
        id: p.id,
        position: p.position,
        points: p.weekly.get(week) ?? 0,
      })),
      slots,
    );
    return Math.max(0, lineup.total - base.byWeek[i]!);
  });
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

export const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

/**
 * How strong each position group is on its own: each week, the points from the roster's best
 * players at the position, as many as the lineup has spots just for them (superflex counts as a
 * quarterback spot). Shared flex spots are left out so that adding a running back does not make
 * the receivers look worse; a bye or a thin bench shows up as a weaker week.
 */
export function groupStrength(roster: SimPlayer[], slots: string[], weeks: number[]) {
  const strength = new Map<string, number>();
  for (const position of POSITIONS) {
    const spots = slots.filter(
      (slot) => slot === position || (position === "QB" && slot === "SUPER_FLEX"),
    ).length;
    const group = roster.filter((p) => p.position === position);
    let total = 0;
    for (const week of weeks)
      total += group
        .map((p) => p.weekly.get(week) ?? 0)
        .sort((a, b) => b - a)
        .slice(0, spots)
        .reduce((sum, v) => sum + v, 0);
    strength.set(position, total);
  }
  return strength;
}

export type PositionChange = {
  position: string;
  /** Points a week from the group's starters, before and after. */
  before: number;
  after: number;
  /** Where the group ranks among the league's teams (1 is best). */
  rankBefore: number;
  rankAfter: number;
};

/**
 * One team's position groups before and after, ranked against every other team in the league.
 * `others` holds the other teams' points a week by position, as they will be after the trade.
 */
export function positionChanges(
  before: Map<string, number>,
  after: Map<string, number>,
  othersBefore: Map<string, number>[],
  othersAfter: Map<string, number>[],
  weeks: number,
): PositionChange[] {
  const rank = (value: number, position: string, others: Map<string, number>[]) =>
    1 + others.filter((team) => (team.get(position) ?? 0) / weeks > value + 1e-9).length;
  return POSITIONS.map((position) => {
    const b = (before.get(position) ?? 0) / weeks;
    const a = (after.get(position) ?? 0) / weeks;
    return {
      position,
      before: b,
      after: a,
      rankBefore: rank(b, position, othersBefore),
      rankAfter: rank(a, position, othersAfter),
    };
  });
}

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** Plain sentences on what the trade does to each position group. */
export function positionStory(changes: PositionChange[], teams: number, who: "You" | "They") {
  const your = who === "You" ? "your" : "their";
  const strong = (rank: number) => rank <= Math.ceil(teams / 3);
  const weak = (rank: number) => rank > Math.floor((teams * 2) / 3);
  const lines: string[] = [];
  for (const c of changes) {
    const change = c.after - c.before;
    if (Math.abs(change) < REAL_CHANGE) continue;
    const ranks =
      c.rankBefore === c.rankAfter
        ? `still ${ordinal(c.rankAfter)} of ${teams}`
        : `${ordinal(c.rankBefore)} to ${ordinal(c.rankAfter)} of ${teams}`;
    const size = `${Math.abs(change).toFixed(1)} points a week`;
    if (change < 0)
      lines.push(
        strong(c.rankBefore) && !weak(c.rankAfter)
          ? `${who} trade from a strength: ${your} ${c.position}s give up ${size} but stay solid (${ranks}).`
          : weak(c.rankAfter)
            ? `This leaves ${your} ${c.position}s thin: down ${size}, ${ranks} in the league.`
            : `${who === "You" ? "Your" : "Their"} ${c.position}s get weaker: down ${size} (${ranks}).`,
      );
    else
      lines.push(
        weak(c.rankBefore)
          ? `This fixes a weak spot: ${your} ${c.position}s gain ${size} (${ranks}).`
          : `${who === "You" ? "Your" : "Their"} ${c.position}s get stronger: up ${size} (${ranks}).`,
      );
  }
  return lines;
}
