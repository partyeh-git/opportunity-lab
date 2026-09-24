import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LeaguePicker, useLeague } from "@/components/league-context";
import { eligible, entriesFor, optimizeLineup, type ResearchEntry } from "@/lib/research-scoring";
import playersSnapshot from "@/data/rankings-current.json";
import { ProjectionDetails } from "@/components/projection-details";
import { PlayerCard } from "@/components/player-card";
import { moveToRank, parseOrder, rankingStorageKey, reconcileOrder } from "@/lib/ranking-order";
import { DEFAULT_LINEUP, leagueValues } from "@/lib/league-value";
import { boardTiers } from "@/lib/tiers";

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

/** Official game designations, shown as the familiar red letter next to a player's name. */
const INJURY_LETTER: Record<string, string> = {
  Questionable: "Q",
  Doubtful: "D",
  Out: "OUT",
  IR: "IR",
  PUP: "PUP",
  Sus: "SUS",
};
type InjuryInfo = { status: string; body: string | null; practice: string | null };

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
  // Current designations, refreshed by the notes job several times a day (public/injuries.json).
  // If that file can't load, fall back to the status saved with the projections.
  const injuries = useQuery({
    queryKey: ["injuries"],
    queryFn: async () => {
      const response = await fetch("/injuries.json");
      if (!response.ok) throw new Error("No injury file");
      return (await response.json()) as { players: Record<string, InjuryInfo> };
    },
    staleTime: 10 * 60 * 1000,
  });
  const injuryOf = (entry: ResearchEntry): InjuryInfo | null => {
    if (injuries.data) return injuries.data.players[entry.sleeperId] ?? null;
    const saved = projectionById.get(entry.id)?.availability;
    return saved && INJURY_LETTER[saved.reportedStatus]
      ? { status: saved.reportedStatus, body: saved.injury || null, practice: null }
      : null;
  };
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
    const values = modelOrder.map((e) =>
      showValue ? (valueModel.values.get(e.id) ?? -Infinity) : e.weekPoints,
    );
    const tierNumbers = showValue ? boardTiers(values, 150, 10) : boardTiers(values, 60, 6);
    return new Map(modelOrder.map((e, i) => [e.id, tierNumbers[i]!]));
    // modelOrder is rebuilt each render; its identity follows these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, effectivePosition, weeklyBoard, defenseBoard, showValue, valueModel, defenseTiers]);
  const lastTier = Math.max(0, ...tiers.values());
  const tierLabel = (tier?: number) =>
    defenseBoard
      ? tier === 4
        ? "Deep stream"
        : `Tier ${tier}`
      : tier === lastTier && tiers.size > (showValue ? 150 : 60)
        ? "Deep"
        : `Tier ${tier}`;
  // Tier lines only make sense when the list runs best to worst.
  const showTiers = ["manual", "model", "value", "points"].includes(sort.key) && !sort.reversed;
  const columnCount = 6 + (weeklyBoard ? 1 : 0) + (showValue ? 1 : 0) + (rosterLoaded ? 2 : 0);
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
  const title = defensesOnly
    ? "DST streaming tiers"
    : weeklyOnly
      ? "Weekly rankings"
      : "Overall rankings";
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
        <table className="w-full min-w-[780px] text-sm">
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
              <SortHeader label="Model" sortKey="model" sort={sort} onSort={sortBy}>
                <p>
                  {showValue
                    ? "Where our model ranks the player on this board: by value above the worst league-wide starter (the Above starter column)."
                    : "Where our model ranks the player on this board: by projected points this week."}
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
                  label="ROS rank"
                  sortKey="ros"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                >
                  <p>
                    The player's overall rank for the rest of the season across all positions, as on
                    the Overall rankings tab: value above the worst league-wide starter in this
                    league. Useful for spotting a low weekly projection on a player who still
                    matters.
                  </p>
                </SortHeader>
              )}
              {showValue && (
                <SortHeader
                  label="Above starter"
                  sortKey="value"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                >
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
                  effectiveHorizon === "week" ? `Week ${playersSnapshot.week} pts` : "Remaining pts"
                }
                sortKey="points"
                sort={sort}
                onSort={sortBy}
                align="right"
              >
                <p>
                  {effectiveHorizon === "week"
                    ? `Projected fantasy points in Week ${playersSnapshot.week}, in this league's scoring.`
                    : `Projected fantasy points for Weeks ${playersSnapshot.week} to 18 in this league's scoring, added up game by game against each opponent. Byes excluded.`}{" "}
                  Confirmed absences count as zero; otherwise we assume the player plays. Click the
                  "i" next to a player's number for how it was built.
                </p>
              </SortHeader>
              {rosterLoaded && (
                <SortHeader
                  label="Lineup impact"
                  sortKey="impact"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                >
                  <p>
                    How much your best projected lineup changes if an outside player joins your
                    team, or if one of your players is removed. It does not deduct a trade return,
                    required drop or keeper cost. Zero means no projected lineup change.
                  </p>
                </SortHeader>
              )}
              {rosterLoaded && <th className="px-3 py-2">League status</th>}
              <th className="px-3 py-2">Matchup</th>
              <th className="px-3 py-2">Week {playersSnapshot.week} usage</th>
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
                        key={`${storageKey}-${sort.key}-${sort.reversed}-${overallRanks.get(entry.id)}`}
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
                      {rosRanks.get(entry.id) ?? "—"}
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
                      <ProjectionDetails player={projectionById.get(entry.id)!}>
                        {pointsFor(entry).toFixed(1)}
                      </ProjectionDetails>
                    ) : (
                      pointsFor(entry).toFixed(1)
                    )}
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
              open
              onOpenChange={(open) => !open && setCardId("")}
              summary={[
                {
                  label: `Week ${playersSnapshot.week} vs ${card.opponent}`,
                  value: `${card.weekPoints.toFixed(1)} pts`,
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
          Tier 1 is the top five defenses by projected Week {playersSnapshot.week} points in this
          league; Tier 2 is ranks 6–12, Tier 3 is 13–20. Estimates use the opponent's prior sacks
          allowed, turnovers, scoring, and yardage together with defensive production. DST
          touchdowns are heavily regressed toward the league average.
        </p>
      )}
    </div>
  );
}
