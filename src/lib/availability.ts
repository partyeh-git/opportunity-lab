import rates from "../data/availability-rates.json" with { type: "json" };
import teamWeeks from "../data/team-weeks-2026.json" with { type: "json" };

/**
 * Chance a player plays this week, from pregame information only: the injury designation, his
 * final practice level of the week (when posted) and how many team games he has just missed in
 * a row. Ranking on chance x points-if-playing raised start/sit accuracy from 63.8% to 69.3% on
 * 2024 (Phase B fix 1). Rates refit 9/28 on 2019-2023 injury reports with practice levels:
 * chance-to-play error (Brier) 0.0875 to 0.0760 on 2024 and 0.0706 to 0.0661 on 2025.
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

/**
 * Most specific learned rate available: status x missed x practice, then status x missed, then status.
 * Rule (9/25): a player with no designation is healthy, so games he just missed never lower his chance.
 * The 2023 "no designation but missed" rates were mostly IR players (IR is never on the injury report);
 * live, IR arrives as its own status. Checked on 2023-24: active starters with no designation after a
 * missed game who did not play were almost all fill-in QBs returning to the bench (a role question).
 */
export function chanceToPlay(s: GameStatus, missed: number, practice = "None"): number {
  if (s === "None") missed = 0;
  return (
    cell[`${s}|${missed}|${practice}`] ??
    statusMissed[`${s}|${missed}`] ??
    status[s] ??
    rates.overall
  );
}

/** Short reason for the chance, e.g. "Questionable" or "missed last 2 games". */
export function chanceReason(s: GameStatus, missed: number, practice?: string): string {
  const parts = [];
  if (s !== "None") parts.push(s);
  if (practice && s !== "Out")
    parts.push(
      { DNP: "did not practice", Limited: "limited practice", Full: "full practice" }[practice] ??
        practice,
    );
  if (missed > 0 && s !== "None")
    parts.push(missed === 1 ? "missed last game" : "missed last 2+ games");
  return parts.join(" · ") || "no injury designation";
}
