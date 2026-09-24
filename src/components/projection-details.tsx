import { useState } from "react";

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
  };
  matchupFactors: Record<
    string,
    { factor: number; weightedOpportunities: number; reliability: number }
  >;
  weeklyForecasts: {
    week: number;
    opponent: string;
    full: number;
    half: number;
    availability?: string;
  }[];
};

export function ProjectionDetails({ player }: { player: DetailPlayer }) {
  const [expanded, setExpanded] = useState(false);
  const labels: Record<string, string> = {
    catch: `${player.position} catch rate`,
    receiving: `Receiving yards vs ${player.position}`,
    rushing: `Rushing yards vs ${player.position}`,
    passing: "QB passing yards",
    receiving_td: `Receiving TDs vs ${player.position}`,
    rushing_td: `Rushing TDs vs ${player.position}`,
    passing_td: "Passing TDs",
    interceptions: "Interceptions",
  };
  const relevant =
    player.position === "QB"
      ? ["passing", "passing_td", "interceptions", "rushing", "rushing_td"]
      : player.position === "RB"
        ? ["rushing", "rushing_td", "catch", "receiving", "receiving_td"]
        : ["catch", "receiving", "receiving_td"];
  return (
    <details
      className="mt-1 max-w-lg text-xs font-normal text-muted-foreground"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-primary">Why this projection?</summary>
      {expanded && (
        <>
          {player.availability && (
            <div className="my-3 space-y-2 rounded-md border p-3 leading-5">
              <p className="font-semibold text-foreground">
                {player.availability.label}
                {player.availability.injury && ` · ${player.availability.injury}`}
              </p>
              <p>{player.availability.note}</p>
              {player.availability.outWeeks.length > 0 && (
                <p>
                  Confirmed missed weeks: {player.availability.outWeeks.join(", ")}. These games
                  contribute zero points. Later points assume a return and are not a confirmed
                  recovery forecast.
                </p>
              )}
              {player.availability.sources.map((s) => (
                <p key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {s.title}
                  </a>
                  {s.publishedDate && ` · published ${s.publishedDate}`}
                </p>
              ))}
              <p>
                Checked {player.availability.reviewedAt.slice(0, 16).replace("T", " ")} UTC. This is
                a saved snapshot, not a live injury feed.
              </p>
            </div>
          )}
          {!!player.roleAdjustments?.length && (
            <div className="my-3 space-y-2 rounded-md border p-3 leading-5">
              <p className="font-semibold text-foreground">
                Workload changes from teammate absences
              </p>
              {player.roleAdjustments.map((a) => (
                <p key={`${a.week}-${a.opportunity}`}>
                  Week {a.week}: +{a.added.toFixed(1)}{" "}
                  {a.opportunity === "attempts" ? "pass attempts" : a.opportunity} with{" "}
                  {a.absentPlayers.join(", ")} out.
                  {a.evidenceGames > 0
                    ? ` Based on ${a.evidenceGames} observed game${a.evidenceGames === 1 ? "" : "s"} during the absence, moderated for the small sample. Only the increase beyond the existing estimate is added.`
                    : ` ${a.note}`}
                </p>
              ))}
              <p>
                These role adjustments are provisional. Unassigned workload is not automatically
                awarded to other players.
              </p>
            </div>
          )}
          <p className="my-2 leading-5">
            {player.workloadEvidence.priorAvailable
              ? `Recent usage has ${(player.workloadEvidence.recentWeight * 100).toFixed(0)}% weight; the rest comes from prior-season usage${player.workloadEvidence.changedTeam ? ", discounted because the player changed teams" : ""}.`
              : "No prior-season player workload is available; this role estimate is especially uncertain."}{" "}
            These weights reflect limited evidence, not a statistical significance test.
          </p>
          <ul className="space-y-1">
            {relevant.map((key) => {
              const f = player.matchupFactors[key];
              if (!f) return null;
              const change = (f.factor - 1) * 100;
              return (
                <li key={key}>
                  {labels[key]}: {change >= 0 ? "+" : ""}
                  {change.toFixed(1)}% ({(f.reliability * 100).toFixed(0)}% evidence weight)
                </li>
              );
            })}
          </ul>
          <p className="my-2 leading-5">
            Each defensive category is estimated separately and moderated for sample size. Positive
            yardage and TD adjustments favor the player; a positive interception adjustment
            increases turnover risk.
          </p>
          <table className="my-2 w-full text-left">
            <caption className="mb-1 text-left">
              Remaining schedule · full / half PPR · conditional on playing except confirmed
              absences
            </caption>
            <thead>
              <tr>
                <th>Week</th>
                <th>Opponent</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {player.weeklyForecasts.map((g) => (
                <tr key={g.week}>
                  <td>
                    {g.week}
                    {g.availability === "out" ? " · Out" : ""}
                  </td>
                  <td>{g.opponent}</td>
                  <td>
                    {g.full.toFixed(1)} / {g.half.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="leading-5">
            Byes are excluded. Future defensive effects fade toward average; workload stays at the
            current role estimate except for the explained absence adjustments. Unresolved injuries,
            workload limits on return, and the effect of a quarterback change on receivers are not
            quantified. These totals are conditional scenarios, not probability-weighted
            availability forecasts.
          </p>
        </>
      )}
    </details>
  );
}
