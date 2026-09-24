import rates from "../data/availability-rates.json" with { type: "json" };
import teamWeeks from "../data/team-weeks-2026.json" with { type: "json" };

/**
 * Chance a player plays this week, from pregame information only: the injury designation,
 * practice participation (when known) and how many team games he has just missed in a row.
 * Rates were learned from 2023 injury reports and confirmed on 2024 (Phase B fix 1): ranking
 * on chance x points-if-playing raised start/sit accuracy from 63.8% to 69.3% on 2024.
 */
export type GameStatus = "Out" | "Doubtful" | "Questionable" | "None";

const cell = rates.cell as Record<string, number>;
const statusMissed = rates.statusMissed as Record<string, number>;
const status = rates.status as Record<string, number>;

/** Sleeper and injury-report wording to the four game statuses. IR, PUP and suspension are out. */
export function gameStatus(raw?: string | null): GameStatus {
  if (!raw) return "None";
  if (raw === "Questionable" || raw === "Doubtful") return raw;
  if (["Out", "IR", "PUP", "Sus", "NA", "DNR"].includes(raw)) return "Out";
  return "None";
}

/** Team games (byes excluded) between the player's last game and this week, capped at 2. */
export function gamesJustMissed(team: string, lastPlayedWeek: number, week: number): number {
  const weeks = (teamWeeks as Record<string, number[]>)[team] ?? [];
  return Math.min(2, weeks.filter((w) => w > lastPlayedWeek && w < week).length);
}

/** Most specific learned rate available: status x missed x practice, then status x missed, then status. */
export function chanceToPlay(s: GameStatus, missed: number, practice = "None"): number {
  return (
    cell[`${s}|${missed}|${practice}`] ??
    statusMissed[`${s}|${missed}`] ??
    status[s] ??
    rates.overall
  );
}

/** Short reason for the chance, e.g. "Questionable" or "missed last 2 games". */
export function chanceReason(s: GameStatus, missed: number): string {
  const parts = [];
  if (s !== "None") parts.push(s);
  if (missed > 0) parts.push(missed === 1 ? "missed last game" : "missed last 2+ games");
  return parts.join(" · ") || "no injury designation";
}
