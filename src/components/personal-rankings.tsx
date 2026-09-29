import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLeague } from "@/components/league-context";
import { eligible, entriesFor, optimizeLineup, type ResearchEntry } from "@/lib/research-scoring";
import { playersSnapshot, seasonSnapshot } from "@/lib/snapshots";
import { ProjectionDetails } from "@/components/projection-details";
import { PlayerCard } from "@/components/player-card";
import { EarlyBuildNote } from "@/components/early-build-note";
import { useWeather, useWeekStatus, WeatherIcons, WeekOverStrip } from "@/components/weather-icons";
import { moveToRank, parseOrder, rankingStorageKey, reconcileOrder } from "@/lib/ranking-order";
import { DEFAULT_LINEUP, leagueValues } from "@/lib/league-value";
import { boardTiers } from "@/lib/tiers";
import { FANTASY_LAST_WEEK } from "@/lib/projection-scoring";
import { INJURY_LETTER, RULED_OUT, projectionsOf, useWeekOutlook } from "@/components/week-outlook";

const genericSettings = { rec: 1, pass_int: -2 };
const teamLabel = (team: string) => (team === "LA" ? "LAR" : team);
const labelFor = (position: string) =>
  ({
    All: "All positions",
    WRRB_FLEX: "WR/RB FLEX",
    SUPER_FLEX: "SUPERFLEX",
    FLEX: "FLEX",
    DEF: "DST",
  })[position] ?? position;
const positionChip: Record<string, string> = {
  QB: "bg-rose-100 text-rose-800 dark:bg-rose-400/20 dark:text-rose-200",
  RB: "bg-lime-100 text-lime-800 dark:bg-lime-400/20 dark:text-lime-200",
  WR: "bg-sky-100 text-sky-800 dark:bg-sky-400/20 dark:text-sky-200",
  TE: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200",
  DEF: "bg-slate-200 text-slate-700 dark:bg-slate-400/20 dark:text-slate-200",
};
/** The league's own starting slots, in lineup order, once each. No mixed "All" board. */
const lineupSlots = (slots?: string[]) => [
  ...new Set(
    (slots ?? DEFAULT_LINEUP).filter((slot) => !["BN", "IR", "TAXI", "RESERVE"].includes(slot)),
  ),
];
/** Overall board filter: everyone, or one of the league's slots. Defenses are weekly only. */
const positionOptions = (slots?: string[]) => [
  "All",
  ...lineupSlots(slots).filter((slot) => slot !== "DEF"),
];

type SortKey = "manual" | "model" | "value" | "points" | "ros" | "impact" | "name";
type Sort = { key: SortKey; reversed: boolean };

/** Small "i" bubble that explains a column or a number without taking table space. */
function InfoBubble({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className="inline-grid h-5 w-5 place-items-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 text-xs normal-case leading-5 tracking-normal">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Column header: click the label to sort (again to reverse), click the "i" for what it means. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  children,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const active = sort.key === sortKey;
  const Arrow = sort.reversed ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-3 py-2 ${align === "right" ? "text-right" : ""}`}
      aria-sort={active ? (sort.reversed ? "ascending" : "descending") : "none"}
    >
      <span
        className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={`inline-flex items-center gap-1 whitespace-nowrap uppercase hover:text-volt ${active ? "text-volt" : ""}`}
        >
          {label}
          {active && <Arrow className="h-3 w-3" aria-hidden="true" />}
        </button>
        <InfoBubble label={`What ${label} means`}>{children}</InfoBubble>
      </span>
    </th>
  );
}

export function PersonalRankings({
  weeklyOnly = false,
  defensesOnly = false,
}: {
  weeklyOnly?: boolean;
  defensesOnly?: boolean;
}) {
  const league = useLeague();
  // The overall board is a season-long page: it reads the early build when there is one.
  const snap = weeklyOnly || defensesOnly ? playersSnapshot : seasonSnapshot;
  const projectionById = projectionsOf(snap);
  const [genericPpr, setGenericPpr] = useState<"full" | "half">("full");
  const [position, setPosition] = useState("All");
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState("All");
  const [sort, setSort] = useState<Sort>({ key: "manual", reversed: false });
  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, reversed: !current.reversed } : { key, reversed: false },
    );
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
  const [cardId, setCardId] = useState("");
  const weatherFor = useWeather(snap.week);
  const weekStatus = useWeekStatus(snap.week);
  // The Weekly tab and the overall Rankings tab are separate boards; each has one horizon.
  const effectiveHorizon = weeklyOnly || defensesOnly ? "week" : "ros";
  const settings = useMemo(
    () =>
      league.selected?.scoring_settings ?? {
        ...genericSettings,
        rec: genericPpr === "full" ? 1 : 0.5,
      },
    [league.selected, genericPpr],
  );
  const entries = useMemo(() => entriesFor(settings, snap), [settings, snap]);
  // Weekly player boards are one roster slot at a time, taken from the league's lineup.
  const weeklyBoard = effectiveHorizon === "week" && !defensesOnly;
  const options = weeklyBoard
    ? lineupSlots(league.selected?.roster_positions)
    : positionOptions(league.selected?.roster_positions);
  const effectivePosition = options.includes(position) ? position : options[0]!;
  const showValue = !defensesOnly && !weeklyBoard;
  const storageKey = rankingStorageKey(
    snap.season,
    snap.week,
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
            ? "On other teams"
            : "Available";
  const rosterFilters = ["All", "My roster", "Available", "On other teams"];
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
  // League value is always rest-of-season: it drives the overall board and the weekly
  // board's "ROS rank" column.
  const valueModel = useMemo(
    () =>
      leagueValues(
        entries.flatMap((entry) =>
          entry.rosPoints === null
            ? []
            : [{ id: entry.id, position: entry.position, points: entry.rosPoints }],
        ),
        league.selected?.total_rosters ?? 12,
        league.selected?.roster_positions ?? DEFAULT_LINEUP,
      ),
    [entries, league.selected],
  );
  const rosRanks = useMemo(
    () =>
      new Map(
        entries
          .filter((entry) => valueModel.values.get(entry.id) != null)
          .sort(
            (a, b) =>
              valueModel.values.get(b.id)! - valueModel.values.get(a.id)! ||
              (b.rosPoints ?? 0) - (a.rosPoints ?? 0) ||
              a.id.localeCompare(b.id),
          )
          .map((entry, index) => [entry.id, index + 1]),
      ),
    [entries, valueModel],
  );
  // Weekly boards show the season rank within the player's position, e.g. QB12.
  const positionRanks = useMemo(() => {
    const counts = new Map<string, number>();
    return new Map(
      entries
        .filter((entry) => rosRanks.has(entry.id))
        .sort((a, b) => rosRanks.get(a.id)! - rosRanks.get(b.id)!)
        .map((entry) => {
          const rank = (counts.get(entry.position) ?? 0) + 1;
          counts.set(entry.position, rank);
          return [entry.id, `${labelFor(entry.position)}${rank}`];
        }),
    );
  }, [entries, rosRanks]);
  const { injuryOf, ifPlays, chances, chanceOf, expectedFor } = useWeekOutlook(
    entries,
    settings,
    snap,
  );
  const pointsFor = (entry: ResearchEntry) =>
    effectiveHorizon === "week" ? ifPlays(entry) : (entry.rosPoints ?? 0);
  const modelOrder = entries
    .filter(
      (entry) =>
        (!defensesOnly || entry.position === "DEF") &&
        (!weeklyBoard || eligible(entry.position, effectivePosition)) &&
        (effectiveHorizon !== "ros" || entry.rosPoints !== null),
    )
    .sort(
      (a, b) =>
        (showValue
          ? (valueModel.values.get(b.id) ?? -Infinity) - (valueModel.values.get(a.id) ?? -Infinity)
          : weeklyBoard
            ? expectedFor(b) - expectedFor(a)
            : 0) ||
        pointsFor(b) - pointsFor(a) ||
        a.id.localeCompare(b.id),
    );
  const modelRanks = new Map(modelOrder.map((entry, index) => [entry.id, index + 1]));
  const myOrder = reconcileOrder(
    customIds,
    modelOrder.map((entry) => entry.id),
  );
  const myRanks = new Map(myOrder.map((id, index) => [id, index + 1]));
  // Higher score = listed first in a column's default direction. Missing values always sink.
  const score = (entry: ResearchEntry): number => {
    if (sort.key === "manual") return -myRanks.get(entry.id)!;
    if (sort.key === "model") return -modelRanks.get(entry.id)!;
    if (sort.key === "value") return valueModel.values.get(entry.id) ?? Number.NaN;
    if (sort.key === "points") return pointsFor(entry);
    if (sort.key === "ros") return -(rosRanks.get(entry.id) ?? Number.NaN);
    if (sort.key === "impact") return impacts.get(entry.id) ?? Number.NaN;
    return 0;
  };
  const ordered = [...modelOrder].sort((a, b) => {
    const direction = sort.reversed ? -1 : 1;
    if (sort.key === "name") return direction * a.name.localeCompare(b.name);
    const sa = score(a);
    const sb = score(b);
    if (Number.isNaN(sa) !== Number.isNaN(sb)) return Number.isNaN(sa) ? 1 : -1;
    const diff = Number.isNaN(sa) ? 0 : sb - sa;
    if (Math.abs(diff) > 0.001) return direction * diff;
    return modelRanks.get(a.id)! - modelRanks.get(b.id)!;
  });
  const overallRanks = new Map(ordered.map((entry, index) => [entry.id, index + 1]));
  // Overall board narrowed to one position: number the list 1, 2, 3 within that position and
  // show the all-positions rank beside it.
  const positionView = showValue && effectivePosition !== "All";
  const rankedList = positionView
    ? ordered.filter((entry) => eligible(entry.position, effectivePosition))
    : ordered;
  const listRanks = new Map(rankedList.map((entry, index) => [entry.id, index + 1]));
  const tierTop = showValue && !positionView ? 150 : 60;
  // Tiers split the board at its natural gaps: weekly points on weekly boards, value above
  // starter on the overall board. DST keeps its streaming tiers. Only the top of the board is
  // split; everyone below is one "Deep" tier.
  const defenseBoard = defensesOnly || (weeklyBoard && effectivePosition === "DEF");
  const tiers = useMemo(() => {
    if (defenseBoard)
      return new Map(
        modelOrder.map((e) => {
          const label = defenseTiers.get(e.id) ?? "";
          return [e.id, label.startsWith("Tier ") ? Number(label.slice(5)) : 4];
        }),
      );
    const pool = positionView
      ? modelOrder.filter((e) => eligible(e.position, effectivePosition))
      : modelOrder;
    const values = pool.map((e) =>
      showValue ? (valueModel.values.get(e.id) ?? -Infinity) : expectedFor(e),
    );
    const tierNumbers = boardTiers(values, tierTop, tierTop === 150 ? 10 : 6);
    return new Map(pool.map((e, i) => [e.id, tierNumbers[i]!]));
    // modelOrder is rebuilt each render; its identity follows these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, effectivePosition, weeklyBoard, defenseBoard, showValue, valueModel, defenseTiers]);
  const lastTier = Math.max(0, ...tiers.values());
  const tierLabel = (tier?: number) =>
    defenseBoard
      ? tier === 4
        ? "Deep stream"
        : `Tier ${tier}`
      : tier === lastTier && tiers.size > tierTop
        ? "Deep"
        : `Tier ${tier}`;
  // Tier lines only make sense when the list runs best to worst.
  const showTiers = ["manual", "model", "value", "points"].includes(sort.key) && !sort.reversed;
  const weekColumns = effectiveHorizon === "week";
  const columnCount =
    4 +
    (weekColumns ? 2 : 0) +
    (weeklyBoard ? 1 : 0) +
    (showValue ? 1 : 0) +
    (rosterLoaded ? 2 : 0);
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
    setSort({ key: "manual", reversed: false });
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
  return (
    <div className="space-y-3">
      {weekStatus.weekOver && <WeekOverStrip week={snap.week} />}
      <EarlyBuildNote snapshot={snap} />
      <section className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="broadcast-tag text-xs uppercase">
          {snap.season} ·{" "}
          {effectiveHorizon === "ros"
            ? `Rest of season · Weeks ${snap.week}–${FANTASY_LAST_WEEK}`
            : `Week ${snap.week}${weekStatus.weekOver ? " · Final" : ""}`}
        </p>
        <p className="text-xs text-muted-foreground">
          Updated{" "}
          {new Date(snap.generatedAt).toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </section>
      <details className="text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer text-primary">How these work</summary>
        <ul className="mt-2 list-disc space-y-1 rounded-md border bg-card p-3 pl-7">
          {defensesOnly || (weeklyBoard && effectivePosition === "DEF") ? (
            <>
              <li>
                A defense's week depends mostly on the offense it faces (65%), then on its own track
                record (35%).
              </li>
              <li>Tiers are broad on purpose: defenses are hard to separate week to week.</li>
            </>
          ) : (
            <>
              <li>
                Our own projections, built from each player's workload this season and last, his
                opponent, and the betting lines. No outside rankings.
              </li>
              <li>
                {effectiveHorizon === "week"
                  ? "Points are what we expect if he plays. A % next to them is his chance to play when there is real doubt."
                  : "Season points add up every remaining game; bye weeks and games a player is ruled out for count as zero."}
              </li>
              <li>
                Injury letters refresh several times a day; projections refresh Tuesday through
                Sunday morning.
              </li>
            </>
          )}
        </ul>
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
              {rosterFilters.map((v) => (
                <option key={v} value={v}>
                  {v === "All" ? "All players" : v}
                </option>
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
      <p role="status" aria-live="polite" className="text-xs text-primary empty:hidden">
        {saveMessage}
      </p>
      <div data-rankings-scroll className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
        <table className={`w-full text-sm ${weekColumns ? "min-w-[780px]" : "min-w-[560px]"}`}>
          <thead className="sticky top-0 z-10 bg-broadcast text-left text-xs font-semibold uppercase tracking-wide text-broadcast-foreground">
            <tr>
              <SortHeader label="My rank" sortKey="manual" sort={sort} onSort={sortBy}>
                <p>
                  Your personal order. Drag the handle, use its arrow keys, or type a rank to move a
                  player. It is saved in this browser, separately for each league, scoring format
                  and board{weeklyBoard ? ", and each lineup slot" : ""}. Model projections stay
                  unchanged.
                </p>
                <p>Sorting by another column and then moving a player saves that order as yours.</p>
              </SortHeader>
              <SortHeader
                label={positionView ? "Overall" : "Model"}
                sortKey="model"
                sort={sort}
                onSort={sortBy}
              >
                <p>
                  {positionView
                    ? "Where our model ranks the player across all positions, as on the full Overall board. My rank counts only the position you picked."
                    : showValue
                      ? "Where our model ranks the player on this board: by value above the worst league-wide starter (the Value column)."
                      : "Where our model ranks the player on this board: points if he plays times his chance to play. A healthy player keeps nearly all his points; a Questionable one is discounted."}
                </p>
              </SortHeader>
              <SortHeader label="Player / team" sortKey="name" sort={sort} onSort={sortBy}>
                <p>
                  Sorts alphabetically. Colored tags show position
                  {defensesOnly ? " and streaming tier" : ""}.
                </p>
              </SortHeader>
              {weeklyBoard && (
                <SortHeader
                  label="Season rank"
                  sortKey="ros"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                >
                  <p>
                    Where the player ranks at his own position for the rest of the season in this
                    league, so QB12 is the 12th best quarterback from here on. Useful for spotting a
                    low weekly projection on a player who still matters.
                  </p>
                </SortHeader>
              )}
              {showValue && (
                <SortHeader label="Value" sortKey="value" sort={sort} onSort={sortBy} align="right">
                  <p>
                    Rest-of-season points above the worst starter at the player's position in this
                    league. We fill every team's starting lineup, including flex and superflex, with
                    the highest projected scorers; the last one picked at each position is the
                    baseline.
                  </p>
                  <p>
                    {league.selected
                      ? `Uses ${league.selected.name}'s scoring and ${league.selected.total_rosters} teams.`
                      : "Assumes 12 teams, 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX and DST; connect your league for its actual lineup."}{" "}
                    Negative means below the starter baseline, not worthless. No keeper or trade
                    value yet.
                  </p>
                  <p>
                    Baselines:{" "}
                    {[...valueModel.baselines]
                      .map(
                        ([pos, baseline]) =>
                          `${labelFor(pos)}${baseline.rank} ${baseline.points.toFixed(1)}`,
                      )
                      .join(" · ")}
                  </p>
                  {valueModel.filledSlots < valueModel.totalSlots && (
                    <p className="text-warning">
                      The modeled player pool cannot fill every starting slot; these baselines are
                      incomplete.
                    </p>
                  )}
                </SortHeader>
              )}
              <SortHeader
                label={
                  effectiveHorizon !== "week"
                    ? "Season pts"
                    : defenseBoard
                      ? `Week ${snap.week} pts`
                      : `Week ${snap.week} pts (if he plays)`
                }
                sortKey="points"
                sort={sort}
                onSort={sortBy}
                align="right"
              >
                <p>
                  {effectiveHorizon === "week"
                    ? `Projected fantasy points in Week ${snap.week} if the player plays, in this league's scoring. When there is real doubt, the % beside it is his chance to play, from the injury designation and games just missed (learned from past injury reports).`
                    : `Projected fantasy points for Weeks ${snap.week} to ${FANTASY_LAST_WEEK} (the end of the fantasy season) in this league's scoring, added up game by game against each opponent. Byes excluded.`}{" "}
                  Confirmed absences count as zero; otherwise we assume the player plays. Click the
                  "i" next to a player's number for how it was built.
                </p>
              </SortHeader>
              {rosterLoaded && (
                <SortHeader
                  label="Helps my lineup"
                  sortKey="impact"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                >
                  <p>
                    Points your best lineup gains if you add this player, or loses if one of your
                    own players is gone. A dash means your lineup would not change. It does not
                    count what you would give up in a trade or have to drop.
                  </p>
                </SortHeader>
              )}
              {rosterLoaded && <th className="px-3 py-2">League status</th>}
              {weekColumns && <th className="px-3 py-2">Matchup</th>}
              {weekColumns && <th className="px-3 py-2">Week {snap.week} projected usage</th>}
            </tr>
          </thead>
          <tbody>
            {ranked.map((entry, index) => (
              <Fragment key={entry.id}>
                {showTiers &&
                  (index === 0 || tiers.get(ranked[index - 1]!.id) !== tiers.get(entry.id)) && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={columnCount}
                        className="border-t-2 border-t-volt bg-muted/60 px-3 py-1 font-display text-sm text-foreground"
                      >
                        {tierLabel(tiers.get(entry.id))}
                      </td>
                    </tr>
                  )}
                <tr
                  data-player-id={entry.id}
                  className={`border-t ${dropTarget === entry.id ? "bg-primary/10 outline outline-primary" : RULED_OUT.has(injuryOf(entry)?.status ?? "") ? "bg-red-100 text-red-700 transition-colors hover:bg-red-200/70 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-950" : "transition-colors hover:bg-accent/50"}`}
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
                        key={`${storageKey}-${sort.key}-${sort.reversed}-${listRanks.get(entry.id)}`}
                        type="number"
                        min={1}
                        max={rankedList.length}
                        disabled={!ready}
                        defaultValue={listRanks.get(entry.id)}
                        aria-label={`Rank for ${entry.name}`}
                        className="w-14 rounded border border-transparent bg-transparent px-1 py-1 text-center font-display text-lg hover:border-input focus:border-primary"
                        onBlur={(event) => {
                          const rank = Number(event.target.value);
                          if (
                            event.target.value &&
                            Number.isInteger(rank) &&
                            rank >= 1 &&
                            rank <= rankedList.length &&
                            rank !== listRanks.get(entry.id)
                          )
                            moveBeside(entry.id, rankedList[rank - 1]!.id);
                          else event.target.value = String(listRanks.get(entry.id));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            event.currentTarget.value = String(listRanks.get(entry.id));
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
                    {projectionById.has(entry.id) ? (
                      <button
                        type="button"
                        onClick={() => setCardId(entry.id)}
                        className="text-left hover:text-primary hover:underline"
                      >
                        {entry.name}
                      </button>
                    ) : (
                      entry.name
                    )}
                    {(() => {
                      const injury = injuryOf(entry);
                      const letter = injury && INJURY_LETTER[injury.status];
                      if (!letter) return null;
                      const detail = [
                        injury.status,
                        injury.body,
                        injury.practice && `Practice: ${injury.practice}`,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <span
                          title={detail}
                          aria-label={detail}
                          className="ml-2 inline-block align-middle font-sans text-sm font-extrabold not-italic leading-none tracking-wide text-red-600 dark:text-red-400"
                        >
                          {letter}
                        </span>
                      );
                    })()}
                    <span
                      className={`ml-2 inline-block -skew-x-6 rounded-sm px-1.5 py-0.5 text-[11px] font-bold ${positionChip[entry.position] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {entry.position === "DEF" ? defenseTiers.get(entry.id) : entry.position}
                    </span>
                    {entry.position !== "DEF" && entry.lastObservedWeek < 2 && (
                      <span className="ml-2 text-xs text-warning">No Week 2 usage</span>
                    )}
                  </td>
                  {weeklyBoard && (
                    <td className="px-4 py-3 text-right font-display text-lg tabular-nums text-muted-foreground">
                      {positionRanks.get(entry.id) ?? "—"}
                    </td>
                  )}
                  {showValue && (
                    <td className="px-4 py-3 text-right font-display text-lg tabular-nums">
                      {valueModel.values.get(entry.id) == null
                        ? "—"
                        : `${valueModel.values.get(entry.id)! >= 0 ? "+" : ""}${valueModel.values.get(entry.id)!.toFixed(1)}`}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-display text-lg tabular-nums">
                    {projectionById.has(entry.id) ? (
                      <ProjectionDetails
                        player={projectionById.get(entry.id)!}
                        chance={weeklyBoard ? chances.get(entry.id) : undefined}
                      >
                        {pointsFor(entry).toFixed(1)}
                      </ProjectionDetails>
                    ) : (
                      pointsFor(entry).toFixed(1)
                    )}
                    {weeklyBoard && chanceOf(entry) < 0.9 && (
                      <span
                        title={`Chance to play · ${chances.get(entry.id)?.reason}`}
                        className={`ml-1.5 font-sans text-xs font-bold not-italic ${chanceOf(entry) < 0.5 ? "text-red-600 dark:text-red-400" : "text-warning"}`}
                      >
                        {Math.round(chanceOf(entry) * 100)}%
                      </span>
                    )}
                  </td>
                  {rosterLoaded && (
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {(impacts.get(entry.id) ?? 0) < 0.05 ? (
                        "—"
                      ) : myIds.has(entry.sleeperId) ? (
                        <>
                          -{impacts.get(entry.id)!.toFixed(1)}{" "}
                          <span className="text-xs text-muted-foreground">if lost</span>
                        </>
                      ) : (
                        <>
                          +{impacts.get(entry.id)!.toFixed(1)}{" "}
                          <span className="text-xs text-muted-foreground">if added</span>
                        </>
                      )}
                    </td>
                  )}
                  {rosterLoaded && (
                    <td className="px-4 py-3 text-muted-foreground">{statusOf(entry)}</td>
                  )}
                  {weekColumns && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {entry.team} vs {entry.opponent}
                      <WeatherIcons weather={weatherFor(entry.team)} />
                    </td>
                  )}
                  {weekColumns && (
                    <td className="px-4 py-3 text-muted-foreground">{entry.detail}</td>
                  )}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        {ranked.length === 0 && (
          <p className="p-6 text-center text-muted-foreground">No results in this view.</p>
        )}
      </div>
      {projectionById.has(cardId) &&
        (() => {
          const card = entries.find((e) => e.id === cardId)!;
          return (
            <PlayerCard
              key={cardId}
              player={projectionById.get(cardId)!}
              settings={settings}
              connected={!!league.selected}
              fromWeek={snap.week}
              open
              onOpenChange={(open) => !open && setCardId("")}
              summary={[
                {
                  label: weekStatus.gameOver(card.team)
                    ? `Week ${snap.week} vs ${card.opponent} · game over`
                    : `Week ${snap.week} vs ${card.opponent}`,
                  value:
                    `${ifPlays(card).toFixed(1)} ${weekStatus.gameOver(card.team) ? "projected" : "pts"}` +
                    (chanceOf(card) < 0.9 ? ` · ${Math.round(chanceOf(card) * 100)}% to play` : ""),
                },
                {
                  label: "Rest of season",
                  value: card.rosPoints == null ? "—" : `${card.rosPoints.toFixed(0)} pts`,
                },
                {
                  label: "Overall rank",
                  value: rosRanks.has(cardId) ? `#${rosRanks.get(cardId)}` : "—",
                },
              ]}
            />
          );
        })()}
      {defensesOnly && (
        <p className="text-xs leading-5 text-muted-foreground">
          Tier 1 is the top five defenses by projected Week {snap.week} points in this league; Tier
          2 is ranks 6–12, Tier 3 is 13–20. Estimates use the opponent's prior sacks allowed,
          turnovers, scoring, and yardage together with defensive production. DST touchdowns are
          heavily regressed toward the league average.
        </p>
      )}
    </div>
  );
}
