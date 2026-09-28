import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLeague } from "@/components/league-context";
import { useWeekStatus, WeekOverStrip } from "@/components/weather-icons";
import { DEFAULT_LINEUP, leagueValues } from "@/lib/league-value";
import { scoreProjectedStats } from "@/lib/projection-scoring";
import { playersSnapshot as snapshot } from "@/lib/snapshots";
import { REAL_CHANGE, simulateSeason, tradeVerdict, type SimPlayer } from "@/lib/trade-sim";

const LAST_WEEK = 18;
const MAX_PER_SIDE = 4;
const genericSettings = { rec: 1, pass_int: -2 };
const signed = (value: number, digits = 1) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
const teamLabel = (team: string) => (team === "LA" ? "LAR" : team);

type TradePlayer = SimPlayer & {
  sleeperId: string;
  team: string;
  /** Projected points from the first unplayed week on. */
  points: number;
  /** Points above the worst league-wide starter, as on the Overall board. */
  value: number;
};
type SleeperUser = {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string } | null;
};

/** One side of the trade: tap a player to add or remove him. */
function Side({
  title,
  choices,
  roster,
  selected,
  onToggle,
}: {
  title: string;
  /** Everyone who can be picked for this side. */
  choices: TradePlayer[];
  /** Show the choices as tappable names (a known roster) instead of a search box. */
  roster: boolean;
  selected: TradePlayer[];
  onToggle: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const query = text.toLowerCase().trim();
  const picked = new Set(selected.map((p) => p.id));
  const full = selected.length >= MAX_PER_SIDE;
  const matches =
    !roster && query
      ? choices
          .filter(
            (p) =>
              !picked.has(p.id) && `${p.name} ${teamLabel(p.team)}`.toLowerCase().includes(query),
          )
          .slice(0, 8)
      : [];
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {selected.length > 0 && (
        <ul className="space-y-1.5">
          {selected.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-md border border-volt bg-background px-3 py-2 text-sm"
            >
              <span>
                <strong>{p.name}</strong>{" "}
                <span className="text-xs text-muted-foreground">
                  {p.position} · {teamLabel(p.team)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  Value {signed(p.value)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => onToggle(p.id)}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-xs text-muted-foreground">Up to {MAX_PER_SIDE} players a side.</p>
      ) : roster ? (
        <div className="flex flex-wrap gap-1.5">
          {choices
            .filter((p) => !picked.has(p.id))
            .map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onToggle(p.id)}
                className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:border-primary hover:bg-accent"
              >
                {p.name} <span className="text-muted-foreground">{p.position}</span>
              </button>
            ))}
        </div>
      ) : (
        <div className="relative">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                onToggle(matches[0].id);
                setText("");
              }
            }}
            placeholder="Type a player's name"
            aria-label={`${title}: add a player`}
          />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover text-sm shadow-lg">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      onToggle(p.id);
                      setText("");
                    }}
                  >
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.position} · {teamLabel(p.team)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function Trades() {
  const league = useLeague();
  const weekStatus = useWeekStatus(snapshot.week);
  const settings = useMemo(
    () => league.selected?.scoring_settings ?? genericSettings,
    [league.selected],
  );
  const lineup = league.selected?.roster_positions ?? DEFAULT_LINEUP;
  const teams = league.selected?.total_rosters ?? 12;
  // Games already played do not count toward a trade.
  const firstWeek = weekStatus.decisionWeek;
  const weeks = useMemo(
    () => Array.from({ length: LAST_WEEK - firstWeek + 1 }, (_, i) => firstWeek + i),
    [firstWeek],
  );
  // Defenses have no rest-of-season projection, so the lineup is played without that spot.
  const slots = useMemo(
    () => lineup.filter((slot) => !["BN", "IR", "TAXI", "RESERVE", "DEF"].includes(slot)),
    [lineup],
  );
  const players = useMemo(() => {
    const scored = snapshot.players.map((p) => {
      const weekly = new Map(
        p.weeklyForecasts
          .filter((g) => g.week >= firstWeek && g.week <= LAST_WEEK)
          .map((g) => [g.week, scoreProjectedStats(g.projected, settings)]),
      );
      return {
        id: p.id,
        sleeperId: p.sleeperId,
        name: p.name,
        position: p.position,
        team: p.team,
        weekly,
        points: [...weekly.values()].reduce((sum, v) => sum + v, 0),
      };
    });
    const values = leagueValues(scored, teams, lineup).values;
    return scored
      .map((p): TradePlayer => ({ ...p, value: values.get(p.id) ?? 0 }))
      .sort((a, b) => b.value - a.value);
  }, [settings, lineup, teams, firstWeek]);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const users = useQuery({
    queryKey: ["sleeper-users", league.selected?.league_id],
    queryFn: async () => {
      const response = await fetch(
        `https://api.sleeper.app/v1/league/${league.selected!.league_id}/users`,
      );
      if (!response.ok) throw new Error("Sleeper team names are unavailable.");
      return (await response.json()) as SleeperUser[];
    },
    enabled: !!league.selected,
    staleTime: 60 * 60 * 1000,
  });
  const teamName = (ownerId: string, rosterId: number) => {
    const user = users.data?.find((u) => u.user_id === ownerId);
    return (user?.metadata?.team_name || user?.display_name || `Team ${rosterId}`).trim();
  };

  const myRoster = league.rosters.find((r) => String(r.owner_id) === league.userId);
  const others = league.rosters.filter((r) => r !== myRoster);
  const connected = !!league.selected && !!myRoster;
  const [partnerId, setPartnerId] = useState(0);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  useEffect(() => {
    setPartnerId(0);
    setGive([]);
    setGet([]);
  }, [league.selected?.league_id]);
  const partner = others.find((r) => r.roster_id === partnerId);
  const rosterOf = (ids: string[] | null | undefined) => {
    const owned = new Set(ids ?? []);
    return players.filter((p) => owned.has(p.sleeperId));
  };
  const mine = useMemo(() => rosterOf(myRoster?.players), [players, myRoster]); // eslint-disable-line react-hooks/exhaustive-deps
  const theirs = useMemo(() => rosterOf(partner?.players), [players, partner]); // eslint-disable-line react-hooks/exhaustive-deps

  const giving = give.flatMap((id) => byId.get(id) ?? []);
  const getting = get.flatMap((id) => byId.get(id) ?? []);
  const toggle = (list: string[], set: (ids: string[]) => void) => (id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const ready = giving.length > 0 && getting.length > 0;

  const result = useMemo(() => {
    if (!ready) return null;
    const swap = (roster: TradePlayer[], out: TradePlayer[], incoming: TradePlayer[]) => [
      ...roster.filter((p) => !out.includes(p)),
      ...incoming,
    ];
    const side = (roster: TradePlayer[], out: TradePlayer[], incoming: TradePlayer[]) => {
      const before = simulateSeason(roster, slots, weeks);
      const after = simulateSeason(swap(roster, out, incoming), slots, weeks);
      return { before, after, perWeek: (after.total - before.total) / weeks.length };
    };
    return {
      me: connected ? side(mine, giving, getting) : null,
      them: connected && partner ? side(theirs, getting, giving) : null,
    };
    // giving/getting are rebuilt each render; their identity follows give/get.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, give, get, mine, theirs, slots, weeks, connected, partner]);

  const valueOut = giving.reduce((sum, p) => sum + p.value, 0);
  const valueIn = getting.reduce((sum, p) => sum + p.value, 0);
  const verdict = result?.me ? tradeVerdict(result.me.perWeek, result.them?.perWeek ?? null) : null;
  const partnerName = partner ? teamName(partner.owner_id, partner.roster_id) : "They";
  // Bench spots: a lopsided player count means someone has to be dropped.
  const spots = lineup.length;
  const rosterCount = (myRoster?.players?.length ?? 0) - (myRoster?.reserve?.length ?? 0);
  const mustDrop = connected ? rosterCount - giving.length + getting.length - spots : 0;

  const reasons = (() => {
    if (!result?.me) return [];
    const { before, after } = result.me;
    const games = (s: typeof before, id: string) => s.starts.get(id) ?? { weeks: 0, points: 0 };
    const lines: string[] = [];
    for (const p of getting) {
      const g = games(after, p.id);
      lines.push(
        g.weeks
          ? `${p.name} starts for you in ${g.weeks} of ${weeks.length} weeks, about ${(g.points / g.weeks).toFixed(1)} points a start.`
          : `${p.name} would not crack your lineup; he is bench depth.`,
      );
    }
    for (const p of giving) {
      const g = games(before, p.id);
      lines.push(
        g.weeks
          ? `You lose ${p.name}, who starts for you in ${g.weeks} of ${weeks.length} weeks at about ${(g.points / g.weeks).toFixed(1)} points.`
          : `${p.name} is not starting for you now, so losing him costs your lineup nothing.`,
      );
    }
    const movers = mine
      .filter((p) => !giving.includes(p))
      .map((p) => ({ p, change: games(after, p.id).weeks - games(before, p.id).weeks }))
      .filter((m) => Math.abs(m.change) >= 2)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 3);
    for (const { p, change } of movers)
      lines.push(
        change > 0
          ? `${p.name} moves into your lineup for ${change} more weeks.`
          : `${p.name} goes to your bench for ${-change} weeks.`,
      );
    return lines;
  })();

  return (
    <div className="space-y-4">
      {weekStatus.weekOver && <WeekOverStrip week={snapshot.week} />}
      <section className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="broadcast-tag text-xs uppercase">
          {snapshot.season} · Trades · Weeks {firstWeek}–{LAST_WEEK}
        </p>
        <p className="text-xs text-muted-foreground">
          {league.selected
            ? `${league.selected.name} scoring and lineup`
            : "Full PPR, 12 teams. Connect your league to see what a trade does to your lineup."}
        </p>
      </section>

      {connected && (
        <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
          <label className="text-sm font-semibold" htmlFor="trade-partner">
            Trade with
          </label>
          <select
            id="trade-partner"
            value={partnerId}
            onChange={(e) => {
              setPartnerId(Number(e.target.value));
              setGet([]);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={0}>Pick a team</option>
            {others.map((r) => (
              <option key={r.roster_id} value={r.roster_id}>
                {teamName(r.owner_id, r.roster_id)}
              </option>
            ))}
          </select>
          {(give.length > 0 || get.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setGive([]);
                setGet([]);
              }}
            >
              Clear trade
            </Button>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Side
          title="You give"
          choices={connected ? mine : players}
          roster={connected}
          selected={giving}
          onToggle={toggle(give, setGive)}
        />
        {connected && !partner ? (
          <section className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <h3 className="font-display text-xl font-semibold text-foreground">You get</h3>
            <p className="mt-3">Pick the team you are trading with to see its players.</p>
          </section>
        ) : (
          <Side
            title="You get"
            choices={(connected ? theirs : players).filter((p) => !give.includes(p.id))}
            roster={connected}
            selected={getting}
            onToggle={toggle(get, setGet)}
          />
        )}
      </div>

      {!ready ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Add at least one player to each side to see who wins the trade.
        </p>
      ) : (
        <section
          className="space-y-4 rounded-lg border-2 border-volt bg-card p-4"
          aria-live="polite"
        >
          {verdict && result?.me ? (
            <>
              <div>
                {verdict.fairness && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {verdict.fairness}
                  </p>
                )}
                <p className="mt-1 font-display text-2xl md:text-3xl">{verdict.headline}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Your lineup", side: result.me },
                  ...(result.them ? [{ label: `${partnerName}'s lineup`, side: result.them }] : []),
                ].map(({ label, side }) => (
                  <div key={label} className="rounded-md bg-muted p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p
                      className={`mt-1 font-display text-3xl tabular-nums ${side.perWeek <= -REAL_CHANGE ? "text-red-600 dark:text-red-400" : side.perWeek >= REAL_CHANGE ? "text-volt" : ""}`}
                    >
                      {signed(side.perWeek)}
                      <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">
                        points a week
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {signed(side.after.total - side.before.total, 0)} over the rest of the season
                      ({side.before.total.toFixed(0)} to {side.after.total.toFixed(0)})
                    </p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Why
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6">
                  {reasons.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              {mustDrop > 0 && (
                <p className="text-sm text-warning">
                  You would have to drop {mustDrop} player{mustDrop > 1 ? "s" : ""} to make room.
                  That cost is not counted here.
                </p>
              )}
            </>
          ) : (
            <p className="font-display text-2xl">
              {Math.abs(valueIn - valueOut) < 10
                ? "Close to even on value"
                : valueIn > valueOut
                  ? "You get more value"
                  : "You give more value"}
            </p>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Value swapped (same Value as the Overall board)
            </p>
            <p className="mt-1 text-sm">
              You give <strong className="tabular-nums">{signed(valueOut)}</strong>, you get{" "}
              <strong className="tabular-nums">{signed(valueIn)}</strong>:{" "}
              <strong className="tabular-nums">{Math.abs(valueIn - valueOut).toFixed(1)}</strong>{" "}
              {valueIn >= valueOut ? "in your favor" : "in their favor"}.
            </p>
          </div>
        </section>
      )}

      <details className="text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer text-primary">How the verdict is made</summary>
        <ul className="mt-2 list-disc space-y-1 rounded-md border bg-card p-3 pl-7">
          <li>
            We play out the rest of the season week by week, before and after the trade, fielding
            each team's best lineup every week. Byes, ruled-out weeks and bench depth all count.
          </li>
          <li>
            A change under {REAL_CHANGE} points a week is treated as no real change. Fair, tilted
            and lopsided compare what each team's lineup gains.
          </li>
          <li>
            Value is points above the worst starter at the position in this league. It can disagree
            with the lineup number: a great player helps less if you are already strong there.
          </li>
          <li>Not counted: keeper value, draft picks, defenses, and who you would drop.</li>
        </ul>
      </details>
    </div>
  );
}
