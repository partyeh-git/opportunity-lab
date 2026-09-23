import { useMemo, useState } from "react";
import { ArrowLeftRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import snapshot from "@/data/rankings-2026-week3.json";

type Player = (typeof snapshot.players)[number];
type Scoring = "full" | "half";
type League = "ballerz" | "plumbuses";
const allPlayers = snapshot.players as Player[];
const fmt = (value: number) => value.toFixed(1);
const points = (player: Player, scoring: Scoring, horizon: "week" | "ros") =>
  horizon === "week"
    ? scoring === "full"
      ? player.weekFull
      : player.weekHalf
    : scoring === "full"
      ? player.rosFull
      : player.rosHalf;
const replacements: Record<League, Record<string, number>> = {
  ballerz: { QB: 20, RB: 20, WR: 30, TE: 10 },
  plumbuses: { QB: 12, RB: 24, WR: 36, TE: 12 },
};

function Intro({ title, description }: { title: string; description: string }) {
  return (
    <section className="border-b pb-6">
      <p className="text-xs font-bold uppercase text-primary">2026 · Week 3 research preview</p>
      <h2 className="mt-2 font-display text-3xl font-semibold md:text-4xl">{title}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
    </section>
  );
}

function Caveat({ trades = false }: { trades?: boolean }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft/50 p-4 text-sm leading-6">
      <strong>Early-season estimate.</strong> Based on NFL player stats through Week 2;{" "}
      {snapshot.candidateCount} players with observed 2026 opportunities and a Week 3 game. This
      version does not account for current injuries, likely lineup changes, or defense matchup
      adjustments. Players without observed attempts, carries, or targets are omitted.
      Rest-of-season totals repeat the current weekly rate over scheduled remaining games; they are
      especially uncertain.
      {trades && " Trade comparisons also depend on who would fill each vacated roster spot."}
    </div>
  );
}

function ScoringButtons({ value, onChange }: { value: Scoring; onChange: (v: Scoring) => void }) {
  return (
    <div className="inline-flex rounded-md border bg-card p-1" aria-label="Reception scoring">
      {(["full", "half"] as const).map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={value === option ? "default" : "ghost"}
          onClick={() => onChange(option)}
        >
          {option === "full" ? "Full PPR" : "Half PPR"}
        </Button>
      ))}
    </div>
  );
}

function statLine(player: Player) {
  const s = player.projected;
  if (player.position === "QB")
    return `${fmt(s.passingYards)} pass yd · ${s.passingTds.toFixed(2)} pass TD · ${fmt(s.carries)} rush att`;
  if (player.position === "RB")
    return `${fmt(s.carries)} carries · ${fmt(s.rushingYards)} rush yd · ${fmt(s.targets)} targets`;
  return `${fmt(s.targets)} targets · ${fmt(s.receptions)} catches · ${fmt(s.receivingYards)} rec yd`;
}

export function Rankings({ weeklyOnly = false }: { weeklyOnly?: boolean }) {
  const [scoring, setScoring] = useState<Scoring>("full");
  const [horizon, setHorizon] = useState<"week" | "ros">("week");
  const [position, setPosition] = useState("All");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const effectiveHorizon = weeklyOnly ? "week" : horizon;
  const ranked = useMemo(
    () =>
      allPlayers
        .filter(
          (p) =>
            (position === "All" || p.position === position) &&
            p.name.toLowerCase().includes(search.toLowerCase().trim()),
        )
        .sort(
          (a, b) => points(b, scoring, effectiveHorizon) - points(a, scoring, effectiveHorizon),
        ),
    [position, search, scoring, effectiveHorizon],
  );
  return (
    <div className="space-y-6">
      <Intro
        title={weeklyOnly ? "Weekly projections" : "Player rankings"}
        description="Original point estimates from observed player opportunity and stabilized efficiency. Change the scoring math without reranking by hand."
      />
      <Caveat />
      <section className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <ScoringButtons value={scoring} onChange={setScoring} />
        {!weeklyOnly && (
          <div className="inline-flex rounded-md border bg-background p-1">
            {(["week", "ros"] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={horizon === option ? "secondary" : "ghost"}
                onClick={() => setHorizon(option)}
              >
                {option === "week" ? "Week 3" : "Rest of season"}
              </Button>
            ))}
          </div>
        )}
        <select
          value={position}
          onChange={(e) => {
            setPosition(e.target.value);
            setLimit(50);
          }}
          aria-label="Position"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {["All", "QB", "RB", "WR", "TE"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <Input
          className="max-w-56"
          placeholder="Search players"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search players"
        />
      </section>
      <p className="text-sm text-muted-foreground">
        {ranked.length} players · Week 3 opponent shown for context · Last refreshed September 22
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[650px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Matchup</th>
              <th className="px-4 py-3">Projected opportunity</th>
              <th className="px-4 py-3 text-right">
                {effectiveHorizon === "week" ? "Week 3 pts" : "Remaining pts"}
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, limit).map((p, i) => (
              <tr key={p.id} className="border-t">
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{i + 1}</td>
                <td className="px-4 py-3 font-semibold">
                  {p.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {p.position}
                  </span>
                  {p.lastObservedWeek < 2 && (
                    <span className="ml-2 text-xs text-warning">No Week 2 usage</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {p.team} vs {p.opponent}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{statLine(p)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {fmt(points(p, scoring, effectiveHorizon))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {ranked.length === 0 && (
          <p className="p-6 text-center text-muted-foreground">
            No matching players in this snapshot.
          </p>
        )}
      </div>
      {limit < ranked.length && (
        <Button variant="outline" onClick={() => setLimit(limit + 50)}>
          Show more
        </Button>
      )}
    </div>
  );
}

function replacementPoints(position: string, league: League, scoring: Scoring) {
  const n = replacements[league][position] ?? 1;
  const sorted = allPlayers
    .filter((p) => p.position === position)
    .sort((a, b) => points(b, scoring, "week") - points(a, scoring, "week"));
  const replacement = sorted[Math.min(n, sorted.length) - 1];
  return replacement ? points(replacement, scoring, "week") : 0;
}

function surplus(player: Player, league: League, scoring: Scoring) {
  return (
    Math.max(
      0,
      points(player, scoring, "week") - replacementPoints(player.position, league, scoring),
    ) * player.remainingGames
  );
}

function PlayerPicker({
  players,
  selected,
  otherSelected,
  onAdd,
  onRemove,
  league,
  scoring,
}: {
  players: Player[];
  selected: string[];
  otherSelected: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  league: League;
  scoring: Scoring;
}) {
  const [query, setQuery] = useState("");
  const matches =
    query.trim().length >= 2
      ? players
          .filter(
            (p) =>
              p.name.toLowerCase().includes(query.toLowerCase().trim()) &&
              !selected.includes(p.id) &&
              !otherSelected.includes(p.id),
          )
          .slice(0, 6)
      : [];
  return (
    <div className="space-y-3">
      <Input
        placeholder="Search for a player"
        aria-label="Search trade players"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <div className="rounded-md border bg-background p-1">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onAdd(p.id);
                setQuery("");
              }}
              className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span>
                {p.name}{" "}
                <span className="text-muted-foreground">
                  {p.position} · {p.team}
                </span>
              </span>
              <Plus className="h-4 w-4" />
            </button>
          ))}
        </div>
      )}
      {selected.length === 0 && (
        <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
          Add up to four players.
        </p>
      )}
      {selected.map((id) => {
        const p = players.find((item) => item.id === id);
        if (!p) return null;
        return (
          <div
            key={id}
            className="flex items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm"
          >
            <div>
              <strong>{p.name}</strong>
              <span className="ml-2 text-muted-foreground">
                {p.position} · {p.team}
              </span>
              <p className="text-xs text-muted-foreground">
                {fmt(surplus(p, league, scoring))} estimated surplus points
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove ${p.name}`}
              onClick={() => onRemove(id)}
            >
              <X />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function Trades() {
  const [league, setLeague] = useState<League>("ballerz");
  const [scoring, setScoring] = useState<Scoring>("full");
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const giveValue = give.reduce(
    (sum, id) =>
      sum +
      surplus(
        allPlayers.find((p) => p.id === id)!,
        league,
        scoring,
      ),
    0,
  );
  const getValue = get.reduce(
    (sum, id) =>
      sum +
      surplus(
        allPlayers.find((p) => p.id === id)!,
        league,
        scoring,
      ),
    0,
  );
  return (
    <div className="space-y-6">
      <Intro
        title="Trade value research"
        description="Compare players using projected rest-of-season points above a position replacement level. This is a starting point for a trade discussion, not a personalized verdict."
      />
      <Caveat trades />
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <label className="text-sm font-semibold">
          League format
          <select
            className="ml-3 h-9 rounded-md border border-input bg-background px-3 text-sm font-normal"
            value={league}
            onChange={(e) => {
              const next = e.target.value as League;
              setLeague(next);
              setScoring(next === "ballerz" ? "full" : "half");
            }}
          >
            <option value="ballerz">10-team superflex</option>
            <option value="plumbuses">12-team 1-QB keeper</option>
          </select>
        </label>
        <ScoringButtons value={scoring} onChange={setScoring} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-5">
          <h3 className="mb-4 font-display text-xl font-semibold">You give</h3>
          <PlayerPicker
            players={allPlayers}
            selected={give}
            otherSelected={get}
            onAdd={(id) => setGive((v) => (v.length < 4 ? [...v, id] : v))}
            onRemove={(id) => setGive((v) => v.filter((x) => x !== id))}
            league={league}
            scoring={scoring}
          />
        </section>
        <section className="rounded-lg border bg-card p-5">
          <h3 className="mb-4 font-display text-xl font-semibold">You get</h3>
          <PlayerPicker
            players={allPlayers}
            selected={get}
            otherSelected={give}
            onAdd={(id) => setGet((v) => (v.length < 4 ? [...v, id] : v))}
            onRemove={(id) => setGet((v) => v.filter((x) => x !== id))}
            league={league}
            scoring={scoring}
          />
        </section>
      </div>
      {give.length > 0 && get.length > 0 && (
        <section className="rounded-lg border bg-card p-5">
          <div className="mb-3 flex items-center gap-2 font-display text-xl font-semibold">
            <ArrowLeftRight className="h-5 w-5" /> Comparison
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <span className="text-xs uppercase text-muted-foreground">Give</span>
              <p className="text-2xl font-semibold tabular-nums">{fmt(giveValue)}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-muted-foreground">Get</span>
              <p className="text-2xl font-semibold tabular-nums">{fmt(getValue)}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-muted-foreground">Estimated difference</span>
              <p className="text-2xl font-semibold tabular-nums">
                {getValue - giveValue >= 0 ? "+" : ""}
                {fmt(getValue - giveValue)}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            These are estimated surplus fantasy points, not auction dollars. The comparison omits
            injuries, bye-week lineup needs, keeper costs, draft picks, and your actual roster. A
            multi-player side also needs open roster spots.
          </p>
        </section>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Replacement level uses the{" "}
        {league === "ballerz"
          ? "20th QB, 20th RB, 30th WR, and 10th TE"
          : "12th QB, 24th RB, 36th WR, and 12th TE"}{" "}
        in this covered player pool. Values are clamped at zero and multiplied by remaining
        scheduled games. Only public NFL statistics are used; no league roster or trade input is
        saved.
      </p>
    </div>
  );
}
