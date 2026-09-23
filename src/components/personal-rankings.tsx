import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LeaguePicker, useLeague } from "@/components/league-context";
import { eligible, entriesFor, optimizeLineup, type ResearchEntry } from "@/lib/research-scoring";
import playersSnapshot from "@/data/rankings-current.json";
import { ProjectionDetails } from "@/components/projection-details";

const projectionById = new Map(playersSnapshot.players.map((p) => [p.id,p]));

const genericSettings = { rec: 1, pass_int: -2 };
const labelFor = (position: string) =>
  ({
    WRRB_FLEX: "WR/RB FLEX",
    SUPER_FLEX: "SUPERFLEX",
    FLEX: "FLEX",
    DEF: "DST",
  })[position] ?? position;
const positionOptions = (slots?: string[]) => [
  "All",
  ...new Set(
    (slots ?? ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "DEF"]).filter(
      (slot) => !["BN", "IR", "TAXI", "RESERVE"].includes(slot),
    ),
  ),
];

export function PersonalRankings({
  weeklyOnly = false,
  defensesOnly = false,
}: {
  weeklyOnly?: boolean;
  defensesOnly?: boolean;
}) {
  const league = useLeague();
  const [genericPpr, setGenericPpr] = useState<"full" | "half">("full");
  const [horizon, setHorizon] = useState<"week" | "ros">(weeklyOnly || defensesOnly ? "week" : "ros");
  const [position, setPosition] = useState("All");
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState("All");
  const [sortMode, setSortMode] = useState<"impact" | "points">(defensesOnly ? "points" : "impact");
  const [limit, setLimit] = useState(50);
  const effectiveHorizon = weeklyOnly || defensesOnly ? "week" : horizon;
  const settings = useMemo(
    () =>
      league.selected?.scoring_settings ?? {
        ...genericSettings,
        rec: genericPpr === "full" ? 1 : 0.5,
      },
    [league.selected, genericPpr],
  );
  const entries = useMemo(() => entriesFor(settings), [settings]);
  const rosters = league.rosters;
  const myRoster = rosters.find((r) => String(r.owner_id) === league.userId);
  const myIds = useMemo(() => new Set(myRoster?.players ?? []), [myRoster]);
  const allRostered = useMemo(() => new Set(rosters.flatMap((r) => r.players ?? [])), [rosters]);
  const rosterLoaded = !!myRoster && !!league.selected;
  const statusOf = (entry: ResearchEntry) =>
    !rosterLoaded
      ? "—"
      : myIds.has(entry.sleeperId)
        ? "My roster"
        : allRostered.has(entry.sleeperId)
          ? "Other roster"
          : "Available";
  const impacts = useMemo(() => {
    if (!rosterLoaded) return new Map<string, number>();
    const slots = league.selected!.roster_positions;
    const owned = entries.filter((e) => myIds.has(e.sleeperId));
    const baseline = optimizeLineup(owned, slots, effectiveHorizon);
    return new Map(
      entries.map((entry) => [
        entry.id,
        myIds.has(entry.sleeperId)
          ? baseline -
            optimizeLineup(
              owned.filter((e) => e.id !== entry.id),
              slots,
              effectiveHorizon,
            )
          : optimizeLineup([...owned, entry], slots, effectiveHorizon) - baseline,
      ]),
    );
  }, [entries, myIds, rosterLoaded, league.selected, effectiveHorizon]);
  const defenseTiers = useMemo(
    () =>
      new Map(
        entries
          .filter((e) => e.position === "DEF")
          .sort((a, b) => b.weekPoints - a.weekPoints)
          .map((e, index) => [
            e.id,
            index < 5 ? "Tier 1" : index < 12 ? "Tier 2" : index < 20 ? "Tier 3" : "Deep stream",
          ]),
      ),
    [entries],
  );
  const options = positionOptions(league.selected?.roster_positions);
  const effectivePosition = options.includes(position) ? position : "All";
  const ranked = entries
    .filter((entry) => {
      if (defensesOnly && entry.position !== "DEF") return false;
      if (
        !defensesOnly &&
        effectivePosition !== "All" &&
        !eligible(entry.position, effectivePosition)
      )
        return false;
      if (effectiveHorizon === "ros" && entry.rosPoints === null) return false;
      if (!entry.name.toLowerCase().includes(search.toLowerCase().trim())) return false;
      if (rosterLoaded && availability !== "All" && statusOf(entry) !== availability) return false;
      return true;
    })
    .sort((a, b) => {
      if (rosterLoaded && sortMode === "impact") {
        const diff = (impacts.get(b.id) ?? 0) - (impacts.get(a.id) ?? 0);
        if (Math.abs(diff) > 0.001) return diff;
      }
      return effectiveHorizon === "week"
        ? b.weekPoints - a.weekPoints
        : (b.rosPoints ?? 0) - (a.rosPoints ?? 0);
    });
  const covered = entries.filter((e) => myIds.has(e.sleeperId)).length;
  const title = defensesOnly
    ? "DST streaming tiers"
    : weeklyOnly
      ? "Weekly projections"
      : "Personalized rankings";
  return (
    <div className="space-y-6">
      <section className="border-b pb-6">
        <p className="text-xs font-bold uppercase text-primary">
          {playersSnapshot.season} · Week {playersSnapshot.week} research preview
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold md:text-4xl">{title}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          {defensesOnly
            ? "Stream defenses by opponent-driven sacks, turnovers, points, and yards. Tiers follow your league's actual DST scoring."
            : "Choose your Sleeper league to rank players by its scoring, lineup slots, and the change each player could make to your team."}
        </p>
      </section>
      <LeaguePicker />
      <div className="rounded-lg border border-warning/30 bg-warning-soft/50 p-4 text-sm leading-6">
        {defensesOnly ? (
          <>
            <strong>DST preview:</strong> Opposing offense drives 65% of each matchup estimate;
            defense history drives 35%. The 2025 historical check showed modest separation, so tiers
            are broad. The formula does not yet use live injury or quarterback news.
          </>
        ) : (
          <>
            <strong>Early-season estimate:</strong> {playersSnapshot.candidateCount} modeled players
            plus 32 DSTs, using NFL statistics through Week {playersSnapshot.dataThroughWeek}.
            Recent usage is blended with prior-season history. Separate defensive adjustments apply
            to rushing, receiving, and passing by position. Remaining points sum each future matchup,
            excluding byes. Injuries and future role changes are not yet modeled; unobserved players
            are omitted. These are experimental estimates, not calibrated outcome ranges.
          </>
        )}
      </div>
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        {!league.selected && (
          <div className="inline-flex rounded-md border bg-background p-1">
            {(["full", "half"] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={genericPpr === v ? "default" : "ghost"}
                onClick={() => setGenericPpr(v)}
              >
                {v === "full" ? "Full PPR" : "Half PPR"}
              </Button>
            ))}
          </div>
        )}
        {!weeklyOnly && !defensesOnly && (
          <div className="inline-flex rounded-md border bg-background p-1">
            {(["week", "ros"] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={horizon === v ? "secondary" : "ghost"}
                onClick={() => setHorizon(v)}
              >
                {v === "week" ? `Week ${playersSnapshot.week}` : "Rest of season"}
              </Button>
            ))}
          </div>
        )}
        {!defensesOnly && (
          <select
            value={effectivePosition}
            onChange={(e) => {
              setPosition(e.target.value);
              setLimit(50);
            }}
            aria-label="Position or lineup slot"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {options.map((v) => (
              <option key={v} value={v}>
                {labelFor(v)}
              </option>
            ))}
          </select>
        )}
        {rosterLoaded && (
          <>
            <select
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              aria-label="League availability"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {["All", "My roster", "Available", "Other roster"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as "impact" | "points")}
              aria-label="Ranking method"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="impact">My lineup impact</option>
              <option value="points">Projected points</option>
            </select>
          </>
        )}
        <Input
          className="max-w-52"
          placeholder={defensesOnly ? "Search teams" : "Search players or teams"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search rankings"
        />
      </section>
      <p className="text-sm text-muted-foreground">
        {ranked.length} results ·{" "}
        {league.selected
          ? `${league.selected.name} scoring and lineup`
          : "General scoring until you connect a league"}
        {rosterLoaded &&
          ` · ${covered} of ${myRoster.players?.length ?? 0} roster entries have a current model estimate`}
        {effectiveHorizon === "ros" &&
          ` · DST excluded because only Week ${playersSnapshot.week} is modeled`}
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Player / team</th>
              <th className="px-4 py-3 text-right">
                {effectiveHorizon === "week" ? `Week ${playersSnapshot.week} pts` : "Remaining pts"}
              </th>
              {rosterLoaded && <th className="px-4 py-3 text-right">Lineup impact</th>}
              {rosterLoaded && <th className="px-4 py-3">League status</th>}
              <th className="px-4 py-3">Matchup</th>
              <th className="px-4 py-3">Projection basis</th>
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, limit).map((entry, index) => (
              <tr key={entry.id} className="border-t">
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{index + 1}</td>
                <td className="px-4 py-3 font-semibold">
                  {entry.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {entry.position === "DEF" ? defenseTiers.get(entry.id) : entry.position}
                  </span>
                  {entry.position !== "DEF" && entry.lastObservedWeek < 2 && (
                    <span className="ml-2 text-xs text-warning">No Week 2 usage</span>
                  )}
                  {projectionById.has(entry.id) && <ProjectionDetails player={projectionById.get(entry.id)!} />}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {(effectiveHorizon === "week"
                    ? entry.weekPoints
                    : (entry.rosPoints ?? 0)
                  ).toFixed(1)}
                </td>
                {rosterLoaded && (
                  <td className="px-4 py-3 text-right tabular-nums">
                    +{Math.max(0, impacts.get(entry.id) ?? 0).toFixed(1)}
                  </td>
                )}
                {rosterLoaded && (
                  <td className="px-4 py-3 text-muted-foreground">{statusOf(entry)}</td>
                )}
                <td className="px-4 py-3 text-muted-foreground">
                  {entry.team} vs {entry.opponent}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{entry.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ranked.length === 0 && (
          <p className="p-6 text-center text-muted-foreground">No results in this view.</p>
        )}
      </div>
      {limit < ranked.length && (
        <Button variant="outline" onClick={() => setLimit(limit + 50)}>
          Show more
        </Button>
      )}
      {rosterLoaded && (
        <p className="text-xs leading-5 text-muted-foreground">
          Lineup impact estimates how much your best projected lineup changes if an outside player
          joins your team, or if one of your players is removed. It does not deduct a trade return,
          required drop, or keeper cost. A zero means no projected lineup change with the current
          modeled roster.
        </p>
      )}
      {defensesOnly && (
        <p className="text-xs leading-5 text-muted-foreground">
          Tier 1 is the top five defenses by projected Week {playersSnapshot.week} points in this
          league; Tier 2 is ranks 6–12, Tier 3 is 13–20. Estimates use the opponent's prior sacks
          allowed, turnovers, scoring, and yardage together with defensive production. DST
          touchdowns are heavily regressed toward the league average.
        </p>
      )}
    </div>
  );
}
