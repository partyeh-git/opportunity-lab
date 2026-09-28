import {
  defensesSnapshot,
  playersSnapshot,
  type DefensesSnapshot,
  type PlayersSnapshot,
} from "@/lib/snapshots";
import { scoreProjectedStats, scoreRemainingGames } from "./projection-scoring";
import { eligible } from "./league-value";
export { eligible } from "./league-value";

export type PlayerProjection = PlayersSnapshot["players"][number];
export type DefenseProjection = DefensesSnapshot["defenses"][number];
export type ResearchEntry = {
  id: string;
  sleeperId: string;
  name: string;
  position: string;
  team: string;
  opponent: string;
  weekPoints: number;
  rosPoints: number | null;
  detail: string;
  lastObservedWeek: number;
};

const value = (settings: Record<string, number>, key: string, fallback = 0) =>
  settings[key] ?? fallback;
const sleeperTeam = (team: string) => (team === "LA" ? "LAR" : team);

export function scorePlayer(player: PlayerProjection, settings: Record<string, number>) {
  return scoreProjectedStats(player.projected, settings);
}

export function scoreDefense(defense: DefenseProjection, settings: Record<string, number>) {
  const events =
    defense.sacks * value(settings, "sack", 1) +
    defense.interceptions * value(settings, "int", 2) +
    defense.forcedFumbles * value(settings, "ff", 1) +
    defense.fumbleRecoveries * value(settings, "fum_rec", 2) +
    defense.defensiveTds * value(settings, "def_td", 6) +
    defense.specialTeamsTds * value(settings, "def_st_td", 6) +
    defense.safeties * value(settings, "safe", 2) +
    defense.blockedKicks * value(settings, "blk_kick", 2);
  const pointsBuckets = Object.entries(defense.pointsAllowedBuckets).reduce(
    (sum, [key, probability]) => sum + probability * value(settings, key),
    0,
  );
  const yardsBuckets = Object.entries(defense.yardsAllowedBuckets).reduce(
    (sum, [key, probability]) => sum + probability * value(settings, key),
    0,
  );
  return events + pointsBuckets + yardsBuckets;
}

export function entriesFor(settings: Record<string, number>): ResearchEntry[] {
  return [
    ...playersSnapshot.players.map((p) => {
      const weekPoints = scorePlayer(p, settings);
      return {
        id: p.id,
        sleeperId: p.sleeperId,
        name: p.name,
        position: p.position,
        team: p.team,
        opponent: p.opponent,
        weekPoints,
        rosPoints: scoreRemainingGames(p, settings),
        lastObservedWeek: p.lastObservedWeek,
        detail:
          p.position === "QB"
            ? `${p.projected.passingYards.toFixed(0)} pass yd · ${p.projected.passingTds.toFixed(1)} pass TD · ${p.projected.carries.toFixed(1)} carries`
            : p.position === "RB"
              ? `${p.projected.carries.toFixed(1)} carries · ${p.projected.targets.toFixed(1)} targets`
              : `${p.projected.targets.toFixed(1)} targets · ${p.projected.receptions.toFixed(1)} catches`,
      };
    }),
    ...defensesSnapshot.defenses.map((d) => ({
      id: `DST-${d.team}`,
      sleeperId: sleeperTeam(d.team),
      name: `${sleeperTeam(d.team)} DST`,
      position: "DEF",
      team: sleeperTeam(d.team),
      opponent: sleeperTeam(d.opponent),
      weekPoints: scoreDefense(d, settings),
      rosPoints: null,
      lastObservedWeek: defensesSnapshot.dataThroughWeek,
      detail: `${d.sacks.toFixed(1)} sacks · ${(d.interceptions + d.fumbleRecoveries).toFixed(1)} takeaways · ${d.expectedPointsAllowed.toFixed(0)} pts allowed`,
    })),
  ];
}

export function optimizeLineup(entries: ResearchEntry[], slots: string[], horizon: "week" | "ros") {
  const usableSlots = slots.filter((slot) => !["BN", "IR", "TAXI", "RESERVE"].includes(slot));
  const n = usableSlots.length;
  if (n > 16) return 0;
  const dp = new Float64Array(1 << n);
  dp.fill(Number.NEGATIVE_INFINITY);
  dp[0] = 0;
  for (const entry of entries) {
    const points = horizon === "week" ? entry.weekPoints : entry.rosPoints;
    if (points === null) continue;
    for (let mask = (1 << n) - 1; mask >= 0; mask--) {
      if (!Number.isFinite(dp[mask])) continue;
      for (let slot = 0; slot < n; slot++) {
        if (!(mask & (1 << slot)) && eligible(entry.position, usableSlots[slot]!)) {
          const next = mask | (1 << slot);
          dp[next] = Math.max(dp[next]!, dp[mask]! + points);
        }
      }
    }
  }
  return Math.max(...dp);
}
