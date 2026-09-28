import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLeague } from "@/components/league-context";
import { Input } from "@/components/ui/input";
import { entriesFor, optimizeLineup, type ResearchEntry } from "@/lib/research-scoring";
import { DEFAULT_LINEUP } from "@/lib/league-value";
import {
  EARLY_WEEKS,
  INJURY_NEWS_MULTIPLIER,
  MAX_BUDGET_SHARE,
  POINTS_FOR_FULL_BUDGET,
  fetchLeagueClaims,
  managerStyles,
  marketFor,
  suggestBid,
  worthDollars,
  type Claim,
} from "@/lib/faab";
import { playersSnapshot as snapshot } from "@/lib/snapshots";
import { fetchPublicJson } from "@/lib/live-data";
import { useWeekStatus, WeekOverStrip } from "@/components/weather-icons";

const HURT = new Set(["Out", "IR", "Doubtful", "PUP", "Sus"]);
const SKILL = ["QB", "RB", "WR", "TE"];
const money = (n: number) => `$${Math.round(n)}`;
const CACHE = "faab-claims-v2";

/** League bid history, cached in this browser for the day (past seasons never change). */
function useClaims(leagueId: string | undefined) {
  return useQuery({
    queryKey: ["faab-claims", leagueId],
    enabled: !!leagueId,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const key = `${CACHE}:${leagueId}:${new Date().toISOString().slice(0, 10)}`;
      try {
        const saved = localStorage.getItem(key);
        if (saved) return JSON.parse(saved) as Claim[];
      } catch {
        /* storage unavailable: fetch instead */
      }
      const claims = await fetchLeagueClaims(leagueId!);
      try {
        for (const k of Object.keys(localStorage))
          if (k.startsWith(`${CACHE}:${leagueId}:`)) localStorage.removeItem(k);
        localStorage.setItem(key, JSON.stringify(claims));
      } catch {
        /* storage full or blocked: keep in memory only */
      }
      return claims;
    },
  });
}

function useJson<T>(key: string, url: string, enabled = true) {
  return useQuery({
    queryKey: [key, url],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      // Files the GitHub jobs refresh (e.g. /injuries.json): read the newest copy.
      if (url.startsWith("/")) {
        const file = await fetchPublicJson<T>(url.slice(1));
        if (file === null) throw new Error(`${url} unavailable`);
        return file;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} unavailable`);
      return (await response.json()) as T;
    },
  });
}

type Row = {
  entry: ResearchEntry;
  rosGain: number;
  weekGain: number;
  worth: number;
  starterHurt: string | null;
  ownStatus: string | null;
  rookie: boolean;
  rivals: { name: string; left: number; style: string; gain: number }[];
  market: ReturnType<typeof marketFor>;
  bid: number;
  priceToWin: number;
  note: string;
};

export function WaiversFaab() {
  const league = useLeague();
  const weekStatus = useWeekStatus(snapshot.week);
  const selected = league.selected;
  const claims = useClaims(selected?.league_id);
  const users = useJson<{ user_id: string; display_name: string }[]>(
    "sleeper-users",
    `https://api.sleeper.app/v1/league/${selected?.league_id}/users`,
    !!selected,
  );
  const lookup = useJson<{ positions: Record<string, string>; rookies: string[] }>(
    "sleeper-positions",
    "/sleeper-positions.json",
  );
  const injuries = useJson<{ players: Record<string, { status: string }> }>(
    "injuries",
    "/injuries.json",
  );
  const [position, setPosition] = useState("All");
  const [search, setSearch] = useState("");

  const settings = useMemo(
    () => selected?.scoring_settings ?? { rec: 1, pass_int: -2 },
    [selected],
  );
  const slots = selected?.roster_positions ?? DEFAULT_LINEUP;
  const budget = selected?.settings?.waiver_budget ?? 100;
  const myRoster = league.rosters.find((r) => String(r.owner_id) === league.userId);
  const budgetLeft = Math.max(0, budget - (myRoster?.settings?.waiver_budget_used ?? 0));
  const early = snapshot.week <= EARLY_WEEKS;
  const names = useMemo(
    () => new Map((users.data ?? []).map((u) => [u.user_id, u.display_name])),
    [users.data],
  );
  const styles = useMemo(() => managerStyles(claims.data ?? []), [claims.data]);

  const rows = useMemo<Row[]>(() => {
    if (!myRoster || !lookup.data) return [];
    const entries = entriesFor(settings).filter((e) => SKILL.includes(e.position));
    const bySleeper = new Map(entries.map((e) => [e.sleeperId, e]));
    const rostered = new Set(league.rosters.flatMap((r) => r.players ?? []));
    const status = (e: ResearchEntry) => injuries.data?.players[e.sleeperId]?.status ?? null;
    const owned = (myRoster.players ?? []).flatMap((id) => bySleeper.get(id) ?? []);
    const baseRos = optimizeLineup(owned, slots, "ros");
    const baseWeek = optimizeLineup(owned, slots, "week");
    // How much each other team would gain: his points over their weakest starter at the position.
    const starters = (pos: string) => Math.max(1, slots.filter((s) => s === pos).length);
    const teams = league.rosters
      .filter((r) => r !== myRoster)
      .map((r) => {
        const theirs = (r.players ?? []).flatMap((id) => bySleeper.get(id) ?? []);
        const weakest = Object.fromEntries(
          SKILL.map((pos) => {
            const healthy = theirs
              .filter((e) => e.position === pos && !HURT.has(status(e) ?? ""))
              .map((e) => e.rosPoints ?? 0)
              .sort((a, b) => b - a);
            return [pos, healthy[starters(pos) - 1] ?? 0];
          }),
        );
        return {
          name: names.get(String(r.owner_id)) ?? `Team ${r.roster_id}`,
          left: Math.max(0, budget - (r.settings?.waiver_budget_used ?? 0)),
          style: styles.get(String(r.owner_id))?.label ?? "typical",
          weakest,
        };
      });
    const available = entries
      .filter((e) => e.sleeperId && !rostered.has(e.sleeperId) && (e.rosPoints ?? 0) > 0)
      .sort((a, b) => (b.rosPoints ?? 0) - (a.rosPoints ?? 0))
      .slice(0, 120);
    return available
      .map((entry) => {
        const rosGain = optimizeLineup([...owned, entry], slots, "ros") - baseRos;
        const weekGain = optimizeLineup([...owned, entry], slots, "week") - baseWeek;
        const ahead = entries.find(
          (e) =>
            e.team === entry.team &&
            e.position === entry.position &&
            e.id !== entry.id &&
            (e.rosPoints ?? 0) > (entry.rosPoints ?? 0) &&
            HURT.has(status(e) ?? ""),
        );
        const rivals = teams
          .map((t) => ({ ...t, gain: (entry.rosPoints ?? 0) - t.weakest[entry.position]! }))
          .filter((t) => t.gain > 10 && t.left > 0)
          .sort((a, b) => b.gain - a.gain);
        const market = marketFor(claims.data ?? [], lookup.data!.positions, entry.position, early);
        const worth = worthDollars(rosGain, budgetLeft);
        const advice = suggestBid({
          worth,
          market,
          starterHurt: !!ahead,
          rivals: rivals.length,
          budgetLeft,
        });
        return {
          entry,
          rosGain,
          weekGain,
          worth,
          starterHurt: ahead ? `${ahead.name} (${status(ahead)})` : null,
          ownStatus: status(entry),
          rookie: lookup.data!.rookies.includes(entry.sleeperId),
          rivals: rivals.map(({ name, left, style, gain }) => ({ name, left, style, gain })),
          market,
          ...advice,
        };
      })
      .sort((a, b) => b.rosGain - a.rosGain || b.weekGain - a.weekGain);
  }, [
    myRoster,
    lookup.data,
    settings,
    league.rosters,
    slots,
    injuries.data,
    names,
    budget,
    styles,
    claims.data,
    early,
    budgetLeft,
  ]);

  const shown = rows.filter(
    (r) =>
      (position === "All" || r.entry.position === position) &&
      r.entry.name.toLowerCase().includes(search.toLowerCase().trim()),
  );
  const positionMarkets = SKILL.map((pos) => ({
    pos,
    market:
      lookup.data && claims.data ? marketFor(claims.data, lookup.data.positions, pos, early) : null,
  }));
  const seasons = claims.data ? [...new Set(claims.data.map((c) => c.season))].sort() : [];

  return (
    <div className="space-y-4">
      {weekStatus.weekOver && <WeekOverStrip week={snapshot.week} />}
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="broadcast-tag text-xs uppercase">
            {snapshot.season} · Week {weekStatus.decisionWeek} waivers
          </p>
        </div>
        <details className="min-w-64 max-w-xl text-sm">
          <summary className="cursor-pointer text-primary">How the bid is set</summary>
          <div className="mt-2 space-y-2 rounded-md border bg-card p-3 text-sm leading-6 text-muted-foreground">
            <p>
              <span className="text-foreground">Worth to you:</span> how many rest-of-season points
              he adds to your best lineup, as a share of your remaining budget: every{" "}
              {POINTS_FOR_FULL_BUDGET} points = your whole budget, capped at{" "}
              {Math.round(MAX_BUDGET_SHARE * 100)}%. A player adding 30 points is worth 30% of what
              you have left. This is the most you should pay.
            </p>
            <p>
              <span className="text-foreground">Price to win:</span> what has won about 70% of this
              league's auctions at his position{early ? " in weeks 1-4" : " after week 4"}, x
              {INJURY_NEWS_MULTIPLIER} when the starter ahead of him is hurt (a learned effect:
              those auctions draw ~40% more bidders). If no other team would clearly start him,
              expect little competition.
            </p>
            <p>
              <span className="text-foreground">Suggested bid:</span> the lower of the two. Nothing
              is submitted for you, and this league's bid history stays in your browser.
            </p>
          </div>
        </details>
      </section>

      {!selected ? (
        <p className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Connect your Sleeper league to see available players, your budget, and bid guidance.
        </p>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-[auto,1fr]">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase text-muted-foreground">Your FAAB left</p>
              <p className="mt-1 font-display text-3xl">
                {myRoster ? money(budgetLeft) : "—"}
                <span className="ml-1 font-sans text-base font-normal normal-case not-italic text-muted-foreground">
                  of {money(budget)}
                </span>
              </p>
            </div>
            <div className="overflow-x-auto rounded-lg border bg-card p-4">
              <p className="text-xs uppercase text-muted-foreground">
                This league's winning bids{early ? ", weeks 1-4" : ", after week 4"}
                {seasons.length > 0 && ` · ${seasons[0]}-${seasons[seasons.length - 1]}`}
                {claims.isLoading && " · loading history…"}
              </p>
              <table className="mt-2 text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pr-6 text-left font-medium">Pos</th>
                    <th className="pr-6 text-right font-medium">Typical</th>
                    <th className="pr-6 text-right font-medium">Top 25%</th>
                    <th className="pr-6 text-right font-medium">Top 10%</th>
                    <th className="text-right font-medium">Record</th>
                  </tr>
                </thead>
                <tbody>
                  {positionMarkets.map(({ pos, market }) => (
                    <tr key={pos}>
                      <td className="pr-6">{pos}</td>
                      <td className="pr-6 text-right">{market ? money(market.median) : "—"}</td>
                      <td className="pr-6 text-right">{market ? money(market.p75) : "—"}</td>
                      <td className="pr-6 text-right">{market ? money(market.p90) : "—"}</td>
                      <td className="text-right">{market ? money(market.max) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Position"
            >
              {["All", ...SKILL].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <Input
              className="w-56"
              placeholder="Search available players"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {claims.isError && (
              <span className="text-sm text-warning">
                League bid history couldn't load; using defaults.
              </span>
            )}
          </section>

          {!myRoster ? (
            <p className="text-sm text-muted-foreground">Loading your roster…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-broadcast text-left text-xs uppercase text-broadcast-foreground">
                  <tr>
                    <th className="px-3 py-2">Available player</th>
                    <th className="px-3 py-2 text-right">Adds to you (ROS)</th>
                    <th className="px-3 py-2 text-right">This week</th>
                    <th className="px-3 py-2 text-right">Worth to you</th>
                    <th className="px-3 py-2 text-right">Price to win</th>
                    <th className="px-3 py-2 text-right">Suggested bid</th>
                    <th className="px-3 py-2">Who else wants him</th>
                    <th className="px-3 py-2">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 60).map((r) => (
                    <tr key={r.entry.id} className="border-t align-top">
                      <td className="px-3 py-2">
                        <span className="font-semibold">{r.entry.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {r.entry.position} · {r.entry.team}
                        </span>
                        {r.ownStatus && (
                          <span className="ml-2 text-xs font-bold text-red-600 dark:text-red-400">
                            {r.ownStatus}
                          </span>
                        )}
                        {r.rookie && (
                          <span className="ml-2 text-xs text-muted-foreground">rookie</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.rosGain > 0.05 ? `+${r.rosGain.toFixed(1)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.weekGain > 0.05 ? `+${r.weekGain.toFixed(1)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{money(r.worth)}</td>
                      <td className="px-3 py-2 text-right">
                        {r.priceToWin ? money(r.priceToWin) : "—"}
                        {r.market && r.rivals.length > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            typical {money(r.market.median)} · top 10% {money(r.market.p90)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-display text-lg">{money(r.bid)}</td>
                      <td className="px-3 py-2 text-xs leading-5">
                        {r.rivals.length ? (
                          r.rivals.slice(0, 3).map((t) => (
                            <span key={t.name} className="block">
                              {t.name} · {money(t.left)} left
                              {t.style !== "typical" && (
                                <span className="text-muted-foreground"> · {t.style}</span>
                              )}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">No clear need</span>
                        )}
                        {r.rivals.length > 3 && (
                          <span className="text-muted-foreground">+{r.rivals.length - 3} more</span>
                        )}
                      </td>
                      <td className="max-w-xs px-3 py-2 text-xs leading-5 text-muted-foreground">
                        {r.starterHurt && (
                          <span className="block text-foreground">
                            Starter hurt: {r.starterHurt}
                          </span>
                        )}
                        {r.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No available players match.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
