import { useMemo, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLeague } from "@/components/league-context";
import { Input } from "@/components/ui/input";
import { entriesFor, type ResearchEntry } from "@/lib/research-scoring";
import { FANTASY_LAST_WEEK, scoreProjectedStats } from "@/lib/projection-scoring";
import {
  gainFromAdding,
  keepValues,
  REAL_CHANGE,
  simulateSeason,
  type SimPlayer,
} from "@/lib/trade-sim";
import { BIG_MOVE, useMovers } from "@/components/movers";
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
import { seasonSnapshot as snapshot } from "@/lib/snapshots";
import { EarlyBuildNote } from "@/components/early-build-note";
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
  /** Points added to my best lineup over the rest of the season, played week by week. */
  rosGain: number;
  /** Points added in the week being decided. */
  weekGain: number;
  /** Weeks he would be in my lineup. */
  weeksStarting: number;
  /** Change in his projected points a game since last week, when known. */
  move: number | null;
  /** Not among the most obvious pickups, but he helps this roster. */
  hidden: boolean;
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
  const [showAll, setShowAll] = useState(false);

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
  const moves = useMovers(settings, snapshot);
  // Games already played do not count; the fantasy season ends in Week 17.
  const firstWeek = weekStatus.decisionWeek;
  const weeks = useMemo(
    () => Array.from({ length: FANTASY_LAST_WEEK - firstWeek + 1 }, (_, i) => firstWeek + i),
    [firstWeek],
  );
  const lineupSlots = useMemo(
    () => slots.filter((slot) => !["BN", "IR", "TAXI", "RESERVE", "DEF"].includes(slot)),
    [slots],
  );
  const sim = useMemo(
    () =>
      new Map(
        snapshot.players.map((p): [string, SimPlayer] => [
          p.id,
          {
            id: p.id,
            name: p.name,
            position: p.position,
            weekly: new Map(
              p.weeklyForecasts
                .filter((g) => g.week >= firstWeek && g.week <= FANTASY_LAST_WEEK)
                .map((g) => [g.week, scoreProjectedStats(g.projected, settings)]),
            ),
          },
        ]),
      ),
    [settings, firstWeek],
  );

  const rows = useMemo<Row[]>(() => {
    if (!myRoster || !lookup.data) return [];
    const entries = entriesFor(settings, snapshot).filter((e) => SKILL.includes(e.position));
    const bySleeper = new Map(entries.map((e) => [e.sleeperId, e]));
    const rostered = new Set(league.rosters.flatMap((r) => r.players ?? []));
    const status = (e: ResearchEntry) => injuries.data?.players[e.sleeperId]?.status ?? null;
    const owned = (myRoster.players ?? []).flatMap((id) => bySleeper.get(id) ?? []);
    const mine = owned.flatMap((e) => sim.get(e.id) ?? []);
    const base = simulateSeason(mine, lineupSlots, weeks);
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
    const obvious = new Set(available.slice(0, 10).map((e) => e.id));
    return available
      .map((entry) => {
        const gains = gainFromAdding(mine, sim.get(entry.id)!, lineupSlots, weeks, base);
        const rosGain = gains.reduce((sum, v) => sum + v, 0);
        const weekGain = gains[0] ?? 0;
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
          weeksStarting: gains.filter((v) => v > 0).length,
          move: moves.get(entry.id) ?? null,
          hidden: !obvious.has(entry.id),
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
    sim,
    lineupSlots,
    weeks,
    moves,
  ]);

  // The answer: the pickups that change my lineup, best first.
  // Chosen one at a time: after the best pickup, the next must still help with him on the team,
  // so the list never offers two players for the same job.
  const picks = useMemo(() => {
    if (!myRoster) return [];
    const owned = new Set(myRoster.players ?? []);
    let roster = snapshot.players
      .filter((p) => owned.has(p.sleeperId))
      .flatMap((p) => sim.get(p.id) ?? []);
    const chosen: Row[] = [];
    while (chosen.length < 3) {
      const base = simulateSeason(roster, lineupSlots, weeks);
      const best = rows
        .filter((r) => !chosen.some((c) => c.entry.id === r.entry.id))
        .map((r) => {
          const gains = gainFromAdding(roster, sim.get(r.entry.id)!, lineupSlots, weeks, base);
          return {
            ...r,
            rosGain: gains.reduce((sum, v) => sum + v, 0),
            weeksStarting: gains.filter((v) => v > 0).length,
          };
        })
        .sort((x, y) => y.rosGain - x.rosGain)[0];
      if (!best || best.rosGain / weeks.length < REAL_CHANGE) break;
      chosen.push(best);
      roster = [...roster, sim.get(best.entry.id)!];
    }
    return chosen;
  }, [rows, myRoster, sim, lineupSlots, weeks]);
  const rising = rows
    .filter((r) => !picks.some((p) => p.entry.id === r.entry.id) && (r.move ?? 0) >= BIG_MOVE)
    .sort((a, b) => b.move! - a.move!)
    .slice(0, 3);
  // Who to let go: the player who is easiest to replace. Judged against the best free agent at
  // his position (scarcity) and as injury cover. Injured-reserve players hold no roster spot.
  const drop = useMemo(() => {
    if (!myRoster || !selected) return null;
    const parked = new Set(myRoster.reserve ?? []);
    const full = (myRoster.players?.length ?? 0) - parked.size >= slots.length;
    if (!full) return { needed: false as const };
    const owned = new Set(myRoster.players ?? []);
    const rostered = new Set(league.rosters.flatMap((r) => r.players ?? []));
    const hurt = (sleeperId: string) => HURT.has(injuries.data?.players[sleeperId]?.status ?? "");
    const modeled = snapshot.players.filter((p) => SKILL.includes(p.position) && sim.has(p.id));
    const roster = modeled.filter((p) => owned.has(p.sleeperId));
    const values = keepValues(
      roster.map((p) => sim.get(p.id)!),
      modeled
        .filter((p) => p.sleeperId && !rostered.has(p.sleeperId) && !hurt(p.sleeperId))
        .map((p) => sim.get(p.id)!),
      new Set(roster.filter((p) => hurt(p.sleeperId)).map((p) => p.id)),
      lineupSlots,
      weeks,
    );
    const onRoster = new Set(roster.filter((p) => !parked.has(p.sleeperId)).map((p) => p.id));
    const ranked = values
      .filter((v) => onRoster.has(v.id))
      .sort(
        (a, b) =>
          Number(a.core) - Number(b.core) ||
          Number(a.scarce) - Number(b.scarce) ||
          a.value - b.value,
      );
    return { needed: true as const, player: ranked[0] ?? null, ranked };
  }, [myRoster, selected, sim, slots, lineupSlots, weeks, league.rosters, injuries.data]);
  const topGain = picks[0]?.rosGain ?? 0;

  const useful = (r: Row) => r.rosGain > 0.05 || (r.move ?? 0) >= BIG_MOVE || !!r.starterHurt;
  const searching = search.trim().length > 0;
  const shown = rows.filter(
    (r) =>
      (showAll || searching || useful(r)) &&
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
      <EarlyBuildNote snapshot={snapshot} />
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
              <span className="text-foreground">Worth to you:</span> how many points he adds to your
              best lineup through Week {FANTASY_LAST_WEEK}, played out week by week so bye weeks and
              depth count, as a share of your remaining budget: every {POINTS_FOR_FULL_BUDGET}{" "}
              points = your whole budget, capped at {Math.round(MAX_BUDGET_SHARE * 100)}%. A player
              adding 30 points is worth 30% of what you have left. This is the most you should pay.
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
          {myRoster && lookup.data && (
            <section className="space-y-3 rounded-lg border-2 border-volt bg-card p-4">
              {picks.length === 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    This week's answer
                  </p>
                  <p className="mt-1 font-display text-2xl md:text-3xl">Save your budget</p>
                  <p className="mt-2 text-sm leading-6">
                    Nobody available would add even {REAL_CHANGE} points a week to your lineup. You
                    have {money(budgetLeft)} left for when someone does.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Go get {picks.length === 1 ? "him" : "them"}
                  </p>
                  <ol className="mt-2 space-y-3">
                    {picks.map((r, i) => (
                      <li
                        key={r.entry.id}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                      >
                        <span className="font-display text-2xl">
                          {i + 1}. {r.entry.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.entry.position} · {r.entry.team}
                        </span>
                        <span className="rounded-sm bg-volt px-2 py-0.5 text-sm font-bold text-black">
                          Bid {money(r.bid)}
                        </span>
                        <span className="w-full text-sm leading-6">
                          {i === 0 ? "Adds" : "On top of that, adds"}{" "}
                          {(r.rosGain / weeks.length).toFixed(1)} points a week to your lineup (
                          {r.rosGain.toFixed(0)} by Week {FANTASY_LAST_WEEK}); he would start for
                          you in {r.weeksStarting} of {weeks.length} weeks.
                          {(r.move ?? 0) >= BIG_MOVE &&
                            ` His outlook jumped ${r.move!.toFixed(1)} points a game this week.`}
                          {r.starterHurt && ` Starter ahead of him is hurt: ${r.starterHurt}.`}
                          {r.hidden &&
                            " Not one of the obvious names, but he fits a hole on your roster."}
                          {r.rivals.length > 0
                            ? ` ${r.rivals.length} other team${r.rivals.length > 1 ? "s" : ""} could use him.`
                            : " No other team clearly needs him."}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {picks.length > 0 &&
                drop?.needed &&
                drop.player &&
                (drop.player.core || drop.player.scarce || drop.player.value >= topGain ? (
                  <p className="text-sm leading-6 text-warning">
                    <strong>Your roster has no easy drop.</strong> The cheapest is{" "}
                    {drop.player.name} ({drop.player.position}),{" "}
                    {drop.player.core
                      ? `but he is part of the depth you need at ${drop.player.position}.`
                      : drop.player.scarce
                        ? "but starting quarterbacks are hard to get back in a superflex league. Try to trade him before you drop him."
                        : `and letting him go costs about ${drop.player.value.toFixed(0)} points, more than the pickup adds.`}{" "}
                    Only make the move if you see it differently.
                  </p>
                ) : (
                  <p className="text-sm leading-6">
                    <strong>To make room, drop {drop.player.name}</strong> ({drop.player.position}
                    ):{" "}
                    {drop.player.reason === "replaceable"
                      ? `free agents at ${drop.player.position} are just as good, and he is not needed as cover.`
                      : drop.player.reason === "cover"
                        ? `he is the easiest to replace. He is cover if ${drop.player.covers} misses time, but you have other depth there.`
                        : drop.player.reason === "covers injury"
                          ? `he is the easiest to replace, though with ${drop.player.covers} out he is worth about ${drop.player.value.toFixed(0)} points to you.`
                          : `he is the easiest to replace, costing about ${drop.player.value.toFixed(0)} points over the rest of the season.`}
                  </p>
                ))}
              {drop?.needed && drop.ranked.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-primary">
                    What each of my players is worth keeping
                  </summary>
                  <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs leading-5 sm:grid-cols-2">
                    {drop.ranked.map((v) => (
                      <li key={v.id} className="flex justify-between gap-2 tabular-nums">
                        <span>
                          {v.name} <span className="text-muted-foreground">{v.position}</span>
                        </span>
                        <span className="text-muted-foreground">
                          {v.value.toFixed(0)} pts
                          {v.reason === "cover" && ` · cover for ${v.covers}`}
                          {v.reason === "covers injury" && ` · with ${v.covers} out`}
                          {v.reason === "replaceable" && " · replaceable"}
                          {v.core && " · needed depth"}
                          {!v.core && v.scarce && " · starting QB, hard to replace"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {rising.length > 0 && (
                <p className="text-sm leading-6 text-muted-foreground">
                  <strong className="text-foreground">
                    Rising, but not a fit for you right now:
                  </strong>{" "}
                  {rising
                    .map(
                      (r) => `${r.entry.name} (${r.entry.position}, +${r.move!.toFixed(1)} a game)`,
                    )
                    .join(", ")}
                  .
                </p>
              )}
            </section>
          )}

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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              Show players who would not help my lineup
            </label>
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
                    <th className="px-3 py-2 text-right">Adds to my lineup (season)</th>
                    <th className="px-3 py-2 text-right">Week {firstWeek}</th>
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
                        {r.move !== null && Math.abs(r.move) >= BIG_MOVE && (
                          <span
                            title="Change in projected points a game since last week"
                            className={`ml-2 inline-flex items-center text-xs font-bold ${r.move > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            <ArrowUp
                              className={`h-3 w-3 ${r.move > 0 ? "" : "rotate-180"}`}
                              aria-hidden="true"
                            />
                            {Math.abs(r.move).toFixed(1)}
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
                <p className="p-4 text-sm text-muted-foreground">
                  {showAll || searching
                    ? "No available players match."
                    : "No available player improves your lineup. Tick the box above to see everyone."}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
