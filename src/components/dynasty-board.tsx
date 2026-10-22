import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, GripVertical, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLeague } from "@/components/league-context";
import { TradeIdeas } from "@/components/trade-ideas";
import { DynastyTradeCalculator } from "@/components/dynasty-trade";
import { fetchPublicJson } from "@/lib/live-data";
import { moveToRank, parseOrder, reconcileOrder } from "@/lib/ranking-order";

type Plan = "win_now" | "balanced" | "rebuild";
type DynastyEntry = {
  id: string;
  name: string;
  pos: string;
  team: string | null;
  age: number | null;
  pickOwner: string | null;
  byYear: number[];
  totals: Record<Plan, number>;
  /** Projected draft slot for next year's picks, from current standings. */
  slot?: "Early" | "Mid" | "Late" | null;
  /** Set when Aryeh's judgment override changed the model value; holds his note. */
  adjusted?: string | null;
  /** Development score, 0-100 within position, young players only. A guide, not part of value. */
  dev?: number | null;
  /** Spread of outcomes among similar past players (Balanced total) and bust chance. */
  risk?: "Low" | "Medium" | "High" | null;
  range?: [number, number, number] | null;
  bust?: number | null;
  devTrend?: "up" | "down" | "flat" | null;
};
type DynastyFile = {
  leagueId: string;
  generatedAt: string;
  years: string[];
  planWeights: Record<Plan, string>;
  players: DynastyEntry[];
};

const PLANS: [Plan, string][] = [
  ["win_now", "Win now"],
  ["balanced", "Balanced"],
  ["rebuild", "Rebuild"],
];
const POSITIONS = ["All", "QB", "RB", "WR", "TE", "PICK"] as const;
const OWNERSHIP = ["All", "My team", "Other teams", "Free agents"] as const;
const PLAN_KEY = "dynasty-plan-v1";
const orderKey = (leagueId: string) => `dynasty-order-v1:${leagueId}`;

const riskChip: Record<string, string> = {
  Low: "bg-lime-100 text-lime-800 dark:bg-lime-400/20 dark:text-lime-200",
  Medium: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200",
  High: "bg-red-100 text-red-800 dark:bg-red-400/20 dark:text-red-200",
};

const positionChip: Record<string, string> = {
  QB: "bg-rose-100 text-rose-800 dark:bg-rose-400/20 dark:text-rose-200",
  RB: "bg-lime-100 text-lime-800 dark:bg-lime-400/20 dark:text-lime-200",
  WR: "bg-sky-100 text-sky-800 dark:bg-sky-400/20 dark:text-sky-200",
  TE: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200",
  PICK: "bg-violet-100 text-violet-800 dark:bg-violet-400/20 dark:text-violet-200",
};

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

/** Long-term player and pick values for a dynasty league, with the team-plan toggle. */
export function DynastyBoard() {
  const league = useLeague();
  const leagueId = league.selected?.league_id ?? "";
  const values = useQuery({
    queryKey: ["dynasty-values"],
    queryFn: () => fetchPublicJson<DynastyFile>("dynasty-values.json"),
    staleTime: Infinity,
  });
  const users = useQuery({
    queryKey: ["league-users", leagueId],
    enabled: Boolean(leagueId),
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
      return response.ok
        ? ((await response.json()) as { user_id: string; display_name: string }[])
        : [];
    },
  });

  const [plan, setPlan] = useState<Plan>("balanced");
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("All");
  const [ownership, setOwnership] = useState<(typeof OWNERSHIP)[number]>("All");
  const [search, setSearch] = useState("");
  const [savedOrder, setSavedOrder] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState("");
  const gesture = useRef<{ id: string; y: number; target: string; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PLAN_KEY) as Plan | null;
      if (stored && PLANS.some(([p]) => p === stored)) setPlan(stored);
      if (leagueId) setSavedOrder(parseOrder(localStorage.getItem(orderKey(leagueId))));
    } catch {
      // Storage blocked: defaults for this visit.
    }
  }, [leagueId]);

  const ownerOf = useMemo(() => {
    const names = new Map((users.data ?? []).map((u) => [u.user_id, u.display_name]));
    const map = new Map<string, string>();
    for (const roster of league.rosters)
      for (const id of [...(roster.players ?? []), ...(roster.reserve ?? [])])
        map.set(id, names.get(roster.owner_id) ?? `Team ${roster.roster_id}`);
    return map;
  }, [league.rosters, users.data]);
  const myName = (users.data ?? []).find((u) => u.user_id === league.userId)?.display_name;

  const file = values.data;
  const entries = useMemo(() => file?.players ?? [], [file]);
  const modelOrder = useMemo(
    () => [...entries].sort((a, b) => b.totals[plan] - a.totals[plan]).map((e) => e.id),
    [entries, plan],
  );
  const modelRank = new Map(modelOrder.map((id, i) => [id, i + 1]));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const order = savedOrder.length ? reconcileOrder(savedOrder, modelOrder) : modelOrder;
  const myRank = new Map(order.map((id, i) => [id, i + 1]));

  if (values.isLoading) return <p className="text-sm text-muted-foreground">Loading values…</p>;
  if (!file)
    return <p className="text-sm text-muted-foreground">Dynasty values didn't load. Refresh.</p>;
  if (leagueId && leagueId !== file.leagueId)
    return (
      <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Dynasty values are built for one league's scoring and lineup so far. Switch to that league
        in the top bar to see them.
      </p>
    );

  const owner = (e: DynastyEntry) => e.pickOwner ?? ownerOf.get(e.id) ?? "";
  const q = search.trim().toLowerCase();
  const shown = order
    .map((id) => byId.get(id)!)
    .filter((e) => {
      if (position !== "All" && e.pos !== position) return false;
      const o = owner(e);
      if (ownership === "My team" && (!myName || o !== myName)) return false;
      if (ownership === "Free agents" && o) return false;
      if (ownership === "Other teams" && (!o || o === myName)) return false;
      if (q && !`${e.name} ${e.team ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });

  function save(ids: string[]) {
    setSavedOrder(ids);
    try {
      if (ids.length) localStorage.setItem(orderKey(leagueId), JSON.stringify(ids));
      else localStorage.removeItem(orderKey(leagueId));
      setMessage(ids.length ? "Your order is saved in this browser." : "Model order restored.");
    } catch {
      setMessage("Order changed for this visit; browser storage could not save it.");
    }
  }
  function moveBeside(id: string, target: string) {
    const rank = myRank.get(target);
    if (rank && id !== target) save(moveToRank(order, id, rank));
  }
  function choosePlan(next: Plan) {
    setPlan(next);
    try {
      localStorage.setItem(PLAN_KEY, next);
    } catch {
      // Not remembered; fine.
    }
  }

  return (
    <div className="space-y-3">
      <section className="space-y-1">
        <p className="broadcast-tag text-xs uppercase">Dynasty · this season through 2032</p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Value = points above the worst starter at the player's position in this league, added up
          season by season. Future seasons come from what similar players (same position, age and
          scoring level) actually did next. Picks are valued from what rookies taken at that slot
          have produced.
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-1 rounded-md border p-1"
          role="group"
          aria-label="Team plan"
        >
          {PLANS.map(([p, label]) => (
            <Button
              key={p}
              size="sm"
              variant={plan === p ? "default" : "ghost"}
              onClick={() => choosePlan(p)}
            >
              {label}
            </Button>
          ))}
        </div>
        <InfoBubble label="What the team plan does">
          <p>How much each future season counts compared with this one.</p>
          {PLANS.map(([p, label]) => (
            <p key={p}>
              <strong>{label}:</strong> {file.planWeights[p]}.
            </p>
          ))}
          <p>Win now lifts proven older players; Rebuild lifts young players and picks.</p>
        </InfoBubble>
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value as (typeof POSITIONS)[number])}
          aria-label="Position"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p === "All" ? "All positions" : p === "PICK" ? "Draft picks" : p}
            </option>
          ))}
        </select>
        <select
          value={ownership}
          onChange={(e) => setOwnership(e.target.value as (typeof OWNERSHIP)[number])}
          aria-label="Ownership"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {OWNERSHIP.map((o) => (
            <option key={o}>{o === "All" ? "All owners" : o}</option>
          ))}
        </select>
        <Input
          className="max-w-52"
          placeholder="Search players or teams"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search dynasty values"
        />
        <Button size="sm" variant="ghost" disabled={!savedOrder.length} onClick={() => save([])}>
          Reset my order
        </Button>
      </section>
      <p role="status" aria-live="polite" className="text-xs text-primary empty:hidden">
        {message}
      </p>

      <div data-dynasty-scroll className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="sticky top-0 z-10 bg-broadcast text-left text-xs font-semibold uppercase tracking-wide text-broadcast-foreground">
            <tr>
              <th className="px-3 py-2">My rank</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2">
                <span className="inline-flex items-center gap-1">
                  Risk
                  <InfoBubble label="What Risk means">
                    <p>
                      How wide this player's outcomes are, based on what similar past players
                      actually did. Hover a label for the bad, typical and great case (Balanced
                      value) and the bust chance: below the starter line in both 2027 and 2028.
                    </p>
                    <p>
                      Two players with the same value can carry very different risk. Low risk = a
                      solid floor; High = the average leans on a few big hits.
                    </p>
                  </InfoBubble>
                </span>
              </th>
              <th className="px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1">
                  Dev
                  <InfoBubble label="What Dev means">
                    <p>
                      Development score for young players (first five NFL seasons), 0 to 100 within
                      position. It blends expert prospect grades (weighted by each source's track
                      record), college production, athletic testing and draft slot, and fades toward
                      real NFL results each season.
                    </p>
                    <p>
                      A guide only: it does not change Value. The arrow shows a move of 3+ points
                      since the season started.
                    </p>
                  </InfoBubble>
                </span>
              </th>
              {file.years.map((y) => (
                <th key={y} className="hidden px-2 py-2 text-right md:table-cell">
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((e, index) => {
              const o = owner(e);
              const mine = Boolean(myName) && o === myName;
              return (
                <tr
                  key={e.id}
                  data-entry-id={e.id}
                  className={`border-t ${mine ? "bg-volt/10" : ""} ${dragging === e.id ? "opacity-50" : ""}`}
                >
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Move ${e.name}`}
                        title="Drag to reorder, or focus and use Up/Down arrows"
                        className="touch-none cursor-grab rounded p-1 focus-visible:ring-2 focus-visible:ring-primary"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          event.currentTarget.focus();
                          gesture.current = {
                            id: e.id,
                            y: event.clientY,
                            target: "",
                            moved: false,
                          };
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={(event) => {
                          const g = gesture.current;
                          if (!g || g.id !== e.id) return;
                          if (!g.moved && Math.abs(event.clientY - g.y) < 6) return;
                          g.moved = true;
                          setDragging(e.id);
                          g.target =
                            document
                              .elementFromPoint(event.clientX, event.clientY)
                              ?.closest<HTMLElement>("[data-entry-id]")?.dataset["entryId"] ?? "";
                        }}
                        onPointerUp={(event) => {
                          const g = gesture.current;
                          gesture.current = null;
                          event.currentTarget.releasePointerCapture(event.pointerId);
                          if (g?.moved && g.target) moveBeside(g.id, g.target);
                          setDragging("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          event.preventDefault();
                          const target = shown[index + (event.key === "ArrowUp" ? -1 : 1)];
                          if (target) moveBeside(e.id, target.id);
                        }}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <span className="w-8 font-display text-lg">{myRank.get(e.id)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                    {modelRank.get(e.id)}
                  </td>
                  <td className="px-3 py-1.5 font-semibold">
                    {e.name}
                    <span
                      className={`ml-2 inline-block -skew-x-6 rounded-sm px-1.5 py-0.5 text-[11px] font-bold ${positionChip[e.pos] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {e.pos === "PICK" ? "PICK" : e.pos}
                    </span>
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {[
                        e.team,
                        e.age ? `age ${Math.floor(e.age)}` : "",
                        e.slot ? `projected ${e.slot.toLowerCase()}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {mine ? <strong className="text-foreground">You</strong> : o || "Free agent"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-display text-lg tabular-nums">
                    {e.adjusted && (
                      <span
                        title={`Adjusted by judgment: ${e.adjusted}`}
                        className="mr-1 align-middle font-sans text-[10px] font-bold uppercase text-hot"
                      >
                        adj
                      </span>
                    )}
                    {Math.round(e.totals[plan])}
                  </td>
                  <td className="px-3 py-1.5">
                    {e.risk && (
                      <span
                        title={
                          e.range
                            ? `Bad ${Math.round(e.range[0])} · Typical ${Math.round(e.range[1])} · Great ${Math.round(e.range[2])}${e.bust != null ? ` · Bust ${e.bust}%` : ""}`
                            : undefined
                        }
                        className={`inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-bold ${riskChip[e.risk] ?? ""}`}
                      >
                        {e.risk}
                        {e.bust != null && (
                          <span className="ml-1 font-normal opacity-80">{e.bust}%</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {e.dev != null && (
                      <span className="inline-flex items-center justify-end gap-0.5">
                        {e.dev}
                        {e.devTrend === "up" && (
                          <ArrowUpRight className="h-3.5 w-3.5 text-lime-600" aria-label="rising" />
                        )}
                        {e.devTrend === "down" && (
                          <ArrowDownRight
                            className="h-3.5 w-3.5 text-red-600"
                            aria-label="falling"
                          />
                        )}
                      </span>
                    )}
                  </td>
                  {e.byYear.map((v, i) => (
                    <td
                      key={file.years[i]}
                      className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground md:table-cell"
                    >
                      {v > 0 ? `+${Math.round(v)}` : "0"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Season columns show points above the worst starter before the team-plan weighting. Updated{" "}
        {new Date(file.generatedAt).toLocaleDateString()}.
      </p>
    </div>
  );
}

/** Dynasty tab: the long-term board, or trade ideas built from the same values. */
export function DynastyScreen() {
  const [view, setView] = useState<"board" | "calc" | "trades">("board");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-md border p-1 w-fit" role="tablist">
        {(
          [
            ["board", "Board"],
            ["calc", "Trade calculator"],
            ["trades", "Trade ideas"],
          ] as const
        ).map(([v, label]) => (
          <Button
            key={v}
            size="sm"
            role="tab"
            aria-selected={view === v}
            variant={view === v ? "default" : "ghost"}
            onClick={() => setView(v)}
          >
            {label}
          </Button>
        ))}
      </div>
      {view === "board" ? (
        <DynastyBoard />
      ) : view === "calc" ? (
        <DynastyTradeCalculator />
      ) : (
        <TradeIdeas />
      )}
    </div>
  );
}
