import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LeaguePicker, useLeague } from "@/components/league-context";
import { eligible, entriesFor, optimizeLineup, type ResearchEntry } from "@/lib/research-scoring";
import playersSnapshot from "@/data/rankings-current.json";
import { ProjectionDetails } from "@/components/projection-details";
import { moveToRank, parseOrder, rankingStorageKey, reconcileOrder } from "@/lib/ranking-order";
import { DEFAULT_LINEUP, leagueValues } from "@/lib/league-value";

const projectionById = new Map(playersSnapshot.players.map((p) => [p.id, p]));

const genericSettings = { rec: 1, pass_int: -2 };
const teamLabel = (team: string) => (team === "LA" ? "LAR" : team);
const labelFor = (position: string) =>
  ({
    WRRB_FLEX: "WR/RB FLEX",
    SUPER_FLEX: "SUPERFLEX",
    FLEX: "FLEX",
    DEF: "DST",
  })[position] ?? position;
const positionChip: Record<string, string> = {
  QB: "bg-pink-500 text-white",
  RB: "bg-volt text-volt-foreground",
  WR: "bg-sky-400 text-sky-950",
  TE: "bg-orange-400 text-orange-950",
  DEF: "bg-violet-500 text-white",
};
const positionOptions = (slots?: string[]) => [
  "All",
  ...new Set(
    ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "DEF", ...(slots ?? [])].filter(
      (slot) => !["BN", "IR", "TAXI", "RESERVE"].includes(slot),
    ),
  ),
];
/** The league's own starting slots, in lineup order, once each. No mixed "All" board. */
const lineupSlots = (slots?: string[]) => [
  ...new Set(
    (slots ?? DEFAULT_LINEUP).filter((slot) => !["BN", "IR", "TAXI", "RESERVE"].includes(slot)),
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
  const [horizon, setHorizon] = useState<"week" | "ros">(
    weeklyOnly || defensesOnly ? "week" : "ros",
  );
  const [position, setPosition] = useState("All");
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState("All");
  const [sortMode, setSortMode] = useState<"manual" | "value" | "impact" | "points">("manual");
  const [team, setTeam] = useState("All");
  const [injuryFilter, setInjuryFilter] = useState("All");
  const [dragging, setDragging] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const gesture = useRef<{
    id: string;
    x: number;
    y: number;
    target: string;
    moved: boolean;
  } | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
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
  // Weekly player boards are one roster slot at a time, taken from the league's lineup.
  const weeklyBoard = effectiveHorizon === "week" && !defensesOnly;
  const options = weeklyBoard
    ? lineupSlots(league.selected?.roster_positions)
    : positionOptions(league.selected?.roster_positions);
  const effectivePosition = options.includes(position) ? position : options[0]!;
  const showValue = !defensesOnly && !weeklyBoard;
  const storageKey = rankingStorageKey(
    playersSnapshot.season,
    playersSnapshot.week,
    effectiveHorizon,
    league.selected?.league_id ?? "general",
    settings,
    defensesOnly,
    weeklyBoard ? effectivePosition : "",
  );
  const [savedOrder, setSavedOrder] = useState<{ key: string; ids: string[] }>({
    key: "",
    ids: [],
  });
  const [undo, setUndo] = useState<{ key: string; ids: string[] } | null>(null);
  useEffect(() => {
    try {
      setSavedOrder({ key: storageKey, ids: parseOrder(localStorage.getItem(storageKey)) });
      setSaveMessage("");
    } catch {
      setSavedOrder({ key: storageKey, ids: [] });
      setSaveMessage("Browser storage is unavailable. Changes will last only for this visit.");
    }
  }, [storageKey]);
  const ready = savedOrder.key === storageKey;
  const customIds = ready ? savedOrder.ids : [];
  const rosters = league.rosters;
  const myRoster = rosters.find((r) => String(r.owner_id) === league.userId);
  const myIds = useMemo(() => new Set(myRoster?.players ?? []), [myRoster]);
  const allRostered = useMemo(() => new Set(rosters.flatMap((r) => r.players ?? [])), [rosters]);
  const rosterLoaded = !!myRoster && !!league.selected;
  const statusOf = (entry: ResearchEntry) =>
    !entry.sleeperId
      ? "Unmatched player ID"
      : !rosterLoaded
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
  const valueModel = useMemo(
    () =>
      leagueValues(
        entries.flatMap((entry) => {
          const points = effectiveHorizon === "week" ? entry.weekPoints : entry.rosPoints;
          return points === null ? [] : [{ id: entry.id, position: entry.position, points }];
        }),
        league.selected?.total_rosters ?? 12,
        league.selected?.roster_positions ?? DEFAULT_LINEUP,
      ),
    [entries, effectiveHorizon, league.selected],
  );
  const pointsFor = (entry: ResearchEntry) =>
    effectiveHorizon === "week" ? entry.weekPoints : (entry.rosPoints ?? 0);
  const modelOrder = entries
    .filter(
      (entry) =>
        (!defensesOnly || entry.position === "DEF") &&
        (!weeklyBoard || eligible(entry.position, effectivePosition)) &&
        (effectiveHorizon !== "ros" || entry.rosPoints !== null),
    )
    .sort(
      (a, b) =>
        (!showValue
          ? 0
          : (valueModel.values.get(b.id) ?? -Infinity) -
            (valueModel.values.get(a.id) ?? -Infinity)) ||
        pointsFor(b) - pointsFor(a) ||
        a.id.localeCompare(b.id),
    );
  const modelRanks = new Map(modelOrder.map((entry, index) => [entry.id, index + 1]));
  const myOrder = reconcileOrder(
    customIds,
    modelOrder.map((entry) => entry.id),
  );
  const myRanks = new Map(myOrder.map((id, index) => [id, index + 1]));
  const ordered = [...modelOrder].sort((a, b) => {
    if (sortMode === "manual") return myRanks.get(a.id)! - myRanks.get(b.id)!;
    if (sortMode === "points") return pointsFor(b) - pointsFor(a) || a.id.localeCompare(b.id);
    if (rosterLoaded && sortMode === "impact") {
      const diff = (impacts.get(b.id) ?? 0) - (impacts.get(a.id) ?? 0);
      if (Math.abs(diff) > 0.001) return diff;
    }
    return modelRanks.get(a.id)! - modelRanks.get(b.id)!;
  });
  const overallRanks = new Map(ordered.map((entry, index) => [entry.id, index + 1]));
  const ranked = ordered.filter((entry) => {
    if (
      !defensesOnly &&
      effectivePosition !== "All" &&
      !eligible(entry.position, effectivePosition)
    )
      return false;
    if (
      !`${entry.name} ${entry.team} ${teamLabel(entry.team)}`
        .toLowerCase()
        .includes(search.toLowerCase().trim())
    )
      return false;
    if (team !== "All" && teamLabel(entry.team) !== team) return false;
    const state = projectionById.get(entry.id)?.availability.state;
    if (injuryFilter === "Hide confirmed out" && state === "confirmed_out") return false;
    if (injuryFilter === "Uncertain availability" && state !== "uncertain") return false;
    if (injuryFilter === "Confirmed out" && state !== "confirmed_out") return false;
    if (rosterLoaded && availability !== "All" && statusOf(entry) !== availability) return false;
    return true;
  });
  function save(ids: string[], remember = true) {
    if (!ready) return;
    if (remember) setUndo({ key: storageKey, ids: customIds });
    setSavedOrder({ key: storageKey, ids });
    setSortMode("manual");
    try {
      if (ids.length) localStorage.setItem(storageKey, JSON.stringify(ids));
      else localStorage.removeItem(storageKey);
      setSaveMessage(ids.length ? "Your order is saved in this browser." : "Model order restored.");
    } catch {
      setSaveMessage("Order changed for this visit; browser storage could not save it.");
    }
  }
  function move(id: string, rank: number) {
    const base = ordered.map((entry) => entry.id);
    save(moveToRank(base, id, rank));
  }
  function moveBeside(id: string, target: string) {
    const rank = overallRanks.get(target);
    if (rank && id !== target) move(id, rank);
  }
  const covered = entries.filter((e) => myIds.has(e.sleeperId)).length;
  const title = defensesOnly
    ? "DST streaming tiers"
    : weeklyOnly
      ? "Weekly projections"
      : "Personalized rankings";
  return (
    <div className="space-y-3">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="broadcast-tag text-xs uppercase">
            {playersSnapshot.season} · Week {playersSnapshot.week}
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{title}</h2>
        </div>
        <details className="min-w-64 text-sm">
          <summary className="cursor-pointer text-primary">
            {league.selected ? league.selected.name : "League & scoring settings"}
          </summary>
          <div className="mt-2">
            <LeaguePicker />
          </div>
        </details>
      </section>
      <details className="rounded-md border border-warning/30 bg-warning-soft/50 px-3 py-2 text-xs leading-5">
        <summary className="cursor-pointer">
          Projection notes · stats through Week {playersSnapshot.dataThroughWeek} · confirmed
          absences excluded; other points assume the player plays
        </summary>
        <div className="mt-2">
          {defensesOnly ? (
            <>
              <strong>DST preview:</strong> Opposing offense drives 65% of each matchup estimate;
              defense history drives 35%. The 2025 historical check showed modest separation, so
              tiers are broad. The formula does not yet use live injury or quarterback news.
            </>
          ) : (
            <>
              <strong>Early-season estimate:</strong> {playersSnapshot.candidateCount} modeled
              players plus 32 DSTs, using NFL statistics through Week{" "}
              {playersSnapshot.dataThroughWeek}. Recent usage is blended with prior-season history.
              Separate defensive adjustments apply to rushing, receiving, and passing by position.
              Remaining points sum each future matchup, excluding byes. Confirmed absences
              contribute zero; other estimates assume the player plays. Uncertain injuries and
              returns are labeled below. Teammate workload changes use observed roles where
              available. Unobserved players are omitted; outcome ranges are not calibrated.
            </>
          )}
        </div>
        {!defensesOnly && (
          <p className="text-xs leading-5 text-muted-foreground">
            Injury check:{" "}
            {playersSnapshot.availabilitySummary.reviewedAt.slice(0, 16).replace("T", " ")} UTC.{" "}
            {playersSnapshot.availabilitySummary.confirmedOutPlayers} confirmed absences in the
            modeled player pool. The injury-report feed currently ends at Week{" "}
            {playersSnapshot.availabilitySummary.latestInjuryReportWeek}; selected official team and
            NFL updates supplement it. No flag means availability is unconfirmed, not that the
            player has been cleared. Saved snapshot; refresh before lineup decisions.
          </p>
        )}
      </details>
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
          </>
        )}
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          aria-label="NFL team filter"
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="All">All teams</option>
          {[...new Set(entries.map((entry) => teamLabel(entry.team)))].sort().map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        {!defensesOnly && (
          <select
            value={injuryFilter}
            onChange={(e) => setInjuryFilter(e.target.value)}
            aria-label="Injury filter"
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {["All", "Hide confirmed out", "Uncertain availability", "Confirmed out"].map(
              (value) => (
                <option key={value} value={value}>
                  {value === "All" ? "All injury statuses" : value}
                </option>
              ),
            )}
          </select>
        )}
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
          aria-label="Ranking method"
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="manual">My order</option>
          <option value="value">
            Model order · {showValue ? "league value" : "projected points"}
          </option>
          {showValue && <option value="points">Projected points only</option>}
          {rosterLoaded && <option value="impact">My lineup impact</option>}
        </select>
        <Input
          className="max-w-52"
          placeholder={defensesOnly ? "Search teams" : "Search players or teams"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search rankings"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!weeklyBoard) setPosition("All");
            setTeam("All");
            setSearch("");
            setAvailability("All");
            setInjuryFilter("All");
          }}
        >
          Clear filters
        </Button>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {ranked.length} of {modelOrder.length} players ·{" "}
          {league.selected ? `${league.selected.name} scoring and lineup` : "General scoring"}
          {rosterLoaded &&
            ` · ${covered} of ${myRoster.players?.length ?? 0} roster entries have a current model estimate`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!ready || undo?.key !== storageKey}
            onClick={() => {
              if (undo?.key === storageKey) {
                save(undo.ids, false);
                setUndo(null);
              }
            }}
          >
            Undo move
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!ready || !customIds.length}
            onClick={() => save([])}
          >
            Reset my order
          </Button>
        </div>
      </div>
      {showValue && (
        <details className="rounded-md border px-3 py-2 text-xs leading-5">
          <summary className="cursor-pointer">
            Model order: points above the positional starter baseline ·{" "}
            {league.selected?.total_rosters ?? 12} teams
            {effectiveHorizon === "ros"
              ? ` · Weeks ${playersSnapshot.week}–18 · this season only`
              : ` · Week ${playersSnapshot.week}`}
          </summary>
          <p className="mt-2">
            {league.selected
              ? "Uses your league’s scoring and starting slots."
              : "Assumes 12 teams, 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX and DST; connect your league for its actual lineup."}{" "}
            We fill the league’s starting spots, including flex and superflex, with the highest
            projected scorers. Each player’s value is their points minus the last starter at their
            position. A negative value means below that starter baseline, not worthless. This is not
            a waiver, trade-price or keeper valuation; keeper costs and future seasons are not
            included.
          </p>
          <p className="mt-1">
            Baselines:{" "}
            {[...valueModel.baselines]
              .map(
                ([pos, baseline]) =>
                  `${labelFor(pos)}${baseline.rank}: ${baseline.points.toFixed(1)} pts`,
              )
              .join(" · ")}
          </p>
          {valueModel.filledSlots < valueModel.totalSlots && (
            <p className="text-warning">
              The modeled player pool cannot fill every supported starting slot; these baselines are
              incomplete.
            </p>
          )}
          {!!customIds.length && (
            <p className="mt-1">
              Your saved order is preserved. Choose “Model order · league value” to see the updated
              baseline ranking.
            </p>
          )}
        </details>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">How to reorder & save</summary>
        <p className="mt-1">
          Drag the handle, use its arrow keys, or enter an overall rank. Filters keep overall rank
          numbers. Your order is saved separately in this browser for each league, scoring format,
          and weekly/season view. Weekly boards show one lineup slot at a time, each with its own
          saved order. Model projections stay unchanged. DST is available in the weekly view only.
        </p>
      </details>
      <p role="status" aria-live="polite" className="text-xs text-primary empty:hidden">
        {saveMessage}
      </p>
      <div data-rankings-scroll className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="sticky top-0 z-10 bg-broadcast text-left text-xs font-semibold uppercase tracking-wide text-broadcast-foreground">
            <tr>
              <th className="px-3 py-2">{sortMode === "manual" ? "My rank" : "Rank"}</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-4 py-3">Player / team</th>
              {showValue && <th className="px-4 py-3 text-right">Above starter</th>}
              <th className="px-4 py-3 text-right">
                {effectiveHorizon === "week" ? `Week ${playersSnapshot.week} pts` : "Remaining pts"}
              </th>
              {rosterLoaded && <th className="px-4 py-3 text-right">Lineup impact</th>}
              {rosterLoaded && <th className="px-4 py-3">League status</th>}
              <th className="px-4 py-3">Matchup</th>
              <th className="px-4 py-3">Week {playersSnapshot.week} usage</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((entry, index) => (
              <tr
                key={entry.id}
                data-player-id={entry.id}
                className={`border-t ${dropTarget === entry.id ? "bg-primary/10 outline outline-primary" : "transition-colors hover:bg-accent/50"}`}
              >
                <td className="px-2 py-2 tabular-nums text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!ready}
                      aria-pressed={dragging === entry.id}
                      aria-label={`Move ${entry.name}`}
                      title="Drag to reorder, or focus and use Up/Down arrows"
                      className="touch-none select-none cursor-grab rounded p-1 focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.currentTarget.focus();
                        gesture.current = {
                          id: entry.id,
                          x: event.clientX,
                          y: event.clientY,
                          target: "",
                          moved: false,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const g = gesture.current;
                        if (!g || g.id !== entry.id) return;
                        if (!g.moved && Math.hypot(event.clientX - g.x, event.clientY - g.y) < 6)
                          return;
                        g.moved = true;
                        setDragging(entry.id);
                        const row = document
                          .elementFromPoint(event.clientX, event.clientY)
                          ?.closest<HTMLElement>("[data-player-id]");
                        g.target = row?.dataset["playerId"] ?? "";
                        setDropTarget(g.target);
                        const scroller =
                          event.currentTarget.closest<HTMLElement>("[data-rankings-scroll]");
                        if (scroller) {
                          const bounds = scroller.getBoundingClientRect();
                          if (event.clientY < bounds.top + 50) scroller.scrollTop -= 20;
                          if (event.clientY > bounds.bottom - 40) scroller.scrollTop += 20;
                        }
                      }}
                      onPointerUp={(event) => {
                        const g = gesture.current;
                        gesture.current = null;
                        event.currentTarget.releasePointerCapture(event.pointerId);
                        if (g?.moved && g.target) moveBeside(g.id, g.target);
                        setDragging("");
                        setDropTarget("");
                      }}
                      onPointerCancel={() => {
                        gesture.current = null;
                        setDragging("");
                        setDropTarget("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                          event.preventDefault();
                          const target = ranked[index + (event.key === "ArrowUp" ? -1 : 1)];
                          if (target) moveBeside(entry.id, target.id);
                        }
                      }}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <input
                      key={`${storageKey}-${sortMode}-${overallRanks.get(entry.id)}`}
                      type="number"
                      min={1}
                      max={modelOrder.length}
                      disabled={!ready}
                      defaultValue={overallRanks.get(entry.id)}
                      aria-label={`Rank for ${entry.name}`}
                      className="w-14 rounded border border-transparent bg-transparent px-1 py-1 text-center font-display text-lg hover:border-input focus:border-primary"
                      onBlur={(event) => {
                        const rank = Number(event.target.value);
                        if (
                          event.target.value &&
                          Number.isInteger(rank) &&
                          rank >= 1 &&
                          rank <= modelOrder.length &&
                          rank !== overallRanks.get(entry.id)
                        )
                          move(entry.id, rank);
                        else event.target.value = String(overallRanks.get(entry.id));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          event.currentTarget.value = String(overallRanks.get(entry.id));
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {modelRanks.get(entry.id)}
                </td>
                <td className="px-4 py-2 font-semibold">
                  {entry.name}
                  {projectionById.get(entry.id)?.availability?.state !== "unverified" &&
                    projectionById.get(entry.id)?.availability && (
                      <span className="ml-2 inline-block rounded border border-warning/40 px-2 py-0.5 text-xs font-medium text-warning">
                        {projectionById.get(entry.id)!.availability.label}
                      </span>
                    )}
                  <span
                    className={`ml-2 inline-block -skew-x-6 rounded-sm px-1.5 py-0.5 text-[11px] font-bold ${positionChip[entry.position] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {entry.position === "DEF" ? defenseTiers.get(entry.id) : entry.position}
                  </span>
                  {entry.position !== "DEF" && entry.lastObservedWeek < 2 && (
                    <span className="ml-2 text-xs text-warning">No Week 2 usage</span>
                  )}
                  {projectionById.has(entry.id) && (
                    <ProjectionDetails player={projectionById.get(entry.id)!} />
                  )}
                </td>
                {showValue && (
                  <td className="px-4 py-3 text-right font-display text-lg tabular-nums">
                    {valueModel.values.get(entry.id) == null
                      ? "—"
                      : `${valueModel.values.get(entry.id)! >= 0 ? "+" : ""}${valueModel.values.get(entry.id)!.toFixed(1)}`}
                  </td>
                )}
                <td className="px-4 py-3 text-right font-display text-lg tabular-nums">
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
