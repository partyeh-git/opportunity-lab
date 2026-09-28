import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type DetailPlayer = {
  position: string;
  availability?: {
    state: string;
    label: string;
    reportedStatus: string;
    injury: string;
    outWeeks: number[];
    note: string;
    reviewedAt: string;
    sources: { title: string; url: string; publishedDate?: string; retrievedAt: string }[];
  };
  roleAdjustments?: {
    week: number;
    opportunity: string;
    added: number;
    absentPlayers: string[];
    evidenceGames: number;
    observedWorkload: number;
    note: string;
  }[];
  workloadEvidence: {
    recentGames: number;
    recentWeight: number;
    priorAvailable: boolean;
    changedTeam: boolean;
    /** Phase B fix 2: recent snap share blended into targets and carries. */
    roleBlend?: {
      snapShareLast2: number;
      targets?: { model: number; blended: number };
      carries?: { model: number; blended: number };
    };
  };
  matchupFactors: Record<
    string,
    { factor: number; weightedOpportunities?: number; reliability?: number; points?: number }
  >;
  weeklyForecasts: {
    week: number;
    opponent: string;
    full: number;
    half: number;
    availability?: string;
  }[];
};

/**
 * Click the projected number to see, in a few lines, what drove it: how much the workload
 * leans on this season, the matchup effects that moved it most, teammate-absence boosts,
 * and any injury flag. The full game log and schedule belong in the player card.
 */
export function ProjectionDetails({
  player,
  chance,
  children,
}: {
  player: DetailPlayer;
  /** Weekly boards: chance the player plays and why. */
  chance?: { value: number; reason: string } | undefined;
  children: ReactNode;
}) {
  const labels: Record<string, string> = {
    catch: "Catch rate",
    receiving: "Receiving yards",
    rushing: "Rushing yards",
    passing: "Passing yards",
    receiving_td: "Receiving TDs",
    rushing_td: "Rushing TDs",
    passing_td: "Passing TDs",
    interceptions: "Interceptions",
  };
  const relevant =
    player.position === "QB"
      ? ["passing", "passing_td", "interceptions", "rushing", "rushing_td"]
      : player.position === "RB"
        ? ["rushing", "rushing_td", "catch", "receiving", "receiving_td"]
        : ["catch", "receiving", "receiving_td"];
  // The two matchup effects that moved this projection most.
  const matchup = relevant
    .flatMap((key) => {
      const f = player.matchupFactors[key];
      return f ? [{ key, change: (f.factor - 1) * 100 }] : [];
    })
    .filter((m) => Math.abs(m.change) >= 1)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 2);
  // Betting line (v3, weekly only): team's implied points vs a 22-point average.
  const implied = player.matchupFactors["implied"];
  const usage = player.workloadEvidence;
  const flagged = player.availability && player.availability.state !== "unverified";
  const boost = player.roleAdjustments?.[0];
  return (
    <Popover>
      <PopoverTrigger
        title="How we got this number"
        className="cursor-pointer underline decoration-dotted decoration-1 underline-offset-4 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 space-y-1.5 text-left font-sans text-xs font-normal not-italic normal-case leading-5 text-muted-foreground"
      >
        <p className="font-semibold text-foreground">How we got this number</p>
        {chance && (
          <p>
            <span className="text-foreground">Chance to play:</span>{" "}
            {Math.round(chance.value * 100)}% ({chance.reason}). The number shown is if he plays.
          </p>
        )}
        <p>
          <span className="text-foreground">Workload:</span>{" "}
          {usage.priorAvailable
            ? `${(usage.recentWeight * 100).toFixed(0)}% this season, the rest last season${usage.changedTeam ? " (new team, discounted)" : ""}.`
            : "no prior-season data, so extra uncertain."}
        </p>
        {usage.roleBlend && (
          <p>
            <span className="text-foreground">Snap role:</span>{" "}
            {Math.round(usage.roleBlend.snapShareLast2 * 100)}% of snaps over his last 2 games
            {(["carries", "targets"] as const)
              .flatMap((k) => {
                const v = usage.roleBlend![k];
                return v && Math.abs(v.blended - v.model) >= 0.3
                  ? [` · ${k} ${v.model.toFixed(1)} → ${v.blended.toFixed(1)}`]
                  : [];
              })
              .join("")}
            .
          </p>
        )}
        <p>
          <span className="text-foreground">Matchup:</span>{" "}
          {matchup.length
            ? matchup
                .map((m) => `${labels[m.key]} ${m.change >= 0 ? "+" : ""}${m.change.toFixed(0)}%`)
                .join(" · ")
            : "about average."}
        </p>
        {implied?.points !== undefined && Math.abs(implied.factor - 1) >= 0.01 && (
          <p>
            <span className="text-foreground">Betting line:</span> team expected to score{" "}
            {implied.points.toFixed(1)} ({implied.factor >= 1 ? "+" : ""}
            {((implied.factor - 1) * 100).toFixed(0)}%).
          </p>
        )}
        {boost && (
          <p>
            <span className="text-foreground">Role:</span> +{boost.added.toFixed(1)}{" "}
            {boost.opportunity === "attempts" ? "pass attempts" : boost.opportunity} with{" "}
            {boost.absentPlayers.join(", ")} out (Week {boost.week}).
          </p>
        )}
        {flagged && (
          <p className="text-warning">
            {player.availability!.label}
            {player.availability!.injury && ` · ${player.availability!.injury}`}
            {player.availability!.outWeeks.length > 0 &&
              `. Counts zero in Week${player.availability!.outWeeks.length > 1 ? "s" : ""} ${player.availability!.outWeeks.join(", ")}`}
            .
          </p>
        )}
        <p>Assumes the player plays unless ruled out. Byes count zero.</p>
      </PopoverContent>
    </Popover>
  );
}
