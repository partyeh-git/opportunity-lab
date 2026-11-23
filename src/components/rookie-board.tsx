import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLeague } from "@/components/league-context";
import { InfoBubble, positionChip } from "@/components/dynasty-board";
import { fetchPublicJson } from "@/lib/live-data";
import { moveToRank, parseOrder, reconcileOrder } from "@/lib/ranking-order";

const CLASS_YEAR = "2027";
type Rookie = {
  id: string;
  rank: number;
  tier: number | null;
  name: string;
  pos: string;
  posRank: number;
  college: string;
  projPick: number | null;
  value: number | null;
  hit: number | null;
  dev: number | null;
  age: number | null;
  flag: string | null;
};
type RookieFile = { leagueId: string; classYear: string; generatedAt: string; players: Rookie[] };

const POSITIONS = ["All", "QB", "RB", "WR", "TE"] as const;
const orderKey = (leagueId: string) => `rookie-order-v1:${CLASS_YEAR}:${leagueId}`;

const tierChip: Record<number, string> = {
  1: "bg-volt/30 text-foreground",
  2: "bg-sky-100 text-sky-800 dark:bg-sky-400/20 dark:text-sky-200",
  3: "bg-lime-100 text-lime-800 dark:bg-lime-400/20 dark:text-lime-200",
  4: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200",
  5: "bg-muted text-muted-foreground",
};

/** Next rookie class scored by our development model, ranked for this league's scoring. */
export function RookieBoard() {
  const league = useLeague();
  const leagueId = league.selected?.league_id ?? "";
  const data = useQuery({
    queryKey: ["rookie-board", CLASS_YEAR],
    queryFn: () => fetchPublicJson<RookieFile>(`rookie-board-${CLASS_YEAR}.json`),
    staleTime: Infinity,
  });
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("All");
  const [search, setSearch] = useState("");
  const [savedOrder, setSavedOrder] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState("");
  const gesture = useRef<{ id: string; y: number; target: string; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      if (leagueId) setSavedOrder(parseOrder(localStorage.getItem(orderKey(leagueId))));
    } catch {
      // Storage blocked: model order for this visit.
    }
  }, [leagueId]);

  const file = data.data;
  const players = useMemo(() => file?.players ?? [], [file]);
  const modelOrder = useMemo(
    () => [...players].sort((a, b) => a.rank - b.rank).map((p) => p.id),
    [players],
  );
  const byId = new Map(players.map((p) => [p.id, p]));
  const order = savedOrder.length ? reconcileOrder(savedOrder, modelOrder) : modelOrder;
  const myRank = new Map(order.map((id, i) => [id, i + 1]));

  if (data.isLoading) return <p className="text-sm text-muted-foreground">Loading rookies…</p>;
  if (!file)
    return <p className="text-sm text-muted-foreground">The rookie board didn't load. Refresh.</p>;
  if (leagueId && leagueId !== file.leagueId)
    return (
      <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        The rookie board is scored for one league's scoring and lineup so far. Switch to that league
        in the top bar to see it.
      </p>
    );

  const q = search.trim().toLowerCase();
  const shown = order
    .map((id) => byId.get(id)!)
    .filter(
      (p) =>
        (position === "All" || p.pos === position) &&
        (!q || `${p.name} ${p.college}`.toLowerCase().includes(q)),
    );

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

  return (
    <div className="space-y-3">
      <section className="space-y-1">
        <p className="broadcast-tag text-xs uppercase">Rookie draft · {file.classYear} class</p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every {file.classYear} prospect scored by our development model and ranked by expected
          value over the first three NFL seasons in this league's scoring. Until the NFL draft,
          draft slot is projected from today's NFL draft boards, so this moves after January
          declarations, the March combine and the draft itself.
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value as (typeof POSITIONS)[number])}
          aria-label="Position"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p === "All" ? "All positions" : p}
            </option>
          ))}
        </select>
        <Input
          className="max-w-52"
          placeholder="Search players or schools"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search rookies"
        />
        <Button size="sm" variant="ghost" disabled={!savedOrder.length} onClick={() => save([])}>
          Reset my order
        </Button>
        <InfoBubble label="How the rookie board is built">
          <p>
            Same development model as the Dev column on the Board: draft slot (about half), expert
            grades, college production and age, athletic testing.
          </p>
          <p>
            <strong>Proj pick:</strong> projected NFL draft slot from today's boards, converted with
            how final boards have matched real picks. Rough until the draft.
          </p>
          <p>
            <strong>Value:</strong> average points above the worst starter over the first three
            seasons, from what past prospects with similar scores actually did. The 3-year window
            undersells young QBs a bit in superflex.
          </p>
          <p>
            <strong>Hit %:</strong> share of similar past prospects who gave any starter-level
            value.
          </p>
          <p>Tiers break where value drops 25% or more, top 40 only.</p>
        </InfoBubble>
      </section>
      <p role="status" aria-live="polite" className="text-xs text-primary empty:hidden">
        {message}
      </p>

      <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="sticky top-0 z-10 bg-broadcast text-left text-xs font-semibold uppercase tracking-wide text-broadcast-foreground">
            <tr>
              <th className="px-3 py-2">My rank</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2 text-right">Proj pick</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2 text-right">Hit %</th>
              <th className="px-3 py-2 text-right">Dev</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p, index) => (
              <tr
                key={p.id}
                data-entry-id={p.id}
                className={`border-t ${dragging === p.id ? "opacity-50" : ""}`}
              >
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${p.name}`}
                      title="Drag to reorder, or focus and use Up/Down arrows"
                      className="touch-none cursor-grab rounded p-1 focus-visible:ring-2 focus-visible:ring-primary"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.currentTarget.focus();
                        gesture.current = { id: p.id, y: event.clientY, target: "", moved: false };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const g = gesture.current;
                        if (!g || g.id !== p.id) return;
                        if (!g.moved && Math.abs(event.clientY - g.y) < 6) return;
                        g.moved = true;
                        setDragging(p.id);
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
                        if (target) moveBeside(p.id, target.id);
                      }}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <span className="w-8 font-display text-lg">{myRank.get(p.id)}</span>
                  </div>
                </td>
                <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{p.rank}</td>
                <td className="px-3 py-1.5 font-semibold">
                  {p.name}
                  <span
                    className={`ml-2 inline-block -skew-x-6 rounded-sm px-1.5 py-0.5 text-[11px] font-bold ${positionChip[p.pos] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {p.pos}
                    {p.posRank}
                  </span>
                  {p.flag && (
                    <AlertTriangle
                      className="ml-1.5 inline h-3.5 w-3.5 text-amber-600"
                      aria-label={p.flag}
                    >
                      <title>{p.flag}</title>
                    </AlertTriangle>
                  )}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {[p.college, p.age ? `age ${Math.floor(p.age)} at draft` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  {p.tier != null && (
                    <span
                      className={`inline-block whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-bold ${tierChip[p.tier] ?? "bg-muted"}`}
                    >
                      Tier {p.tier}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {p.projPick ?? "?"}
                </td>
                <td className="px-3 py-1.5 text-right font-display text-lg tabular-nums">
                  {p.value ?? ""}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {p.hit != null ? `${p.hit}%` : ""}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {p.dev ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Amber triangle: not on every NFL board yet (may return to school), so the draft slot is
        shakier. Scored {new Date(file.generatedAt).toLocaleDateString()}.
      </p>
    </div>
  );
}
