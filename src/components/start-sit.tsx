import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLeague } from "@/components/league-context";
import { PlayerCard } from "@/components/player-card";
import { useWeather, useWeekStatus, WeatherIcons, WeekOverStrip } from "@/components/weather-icons";
import {
  INJURY_LETTER,
  RULED_OUT,
  projectionById,
  useWeekOutlook,
} from "@/components/week-outlook";
import { DEFAULT_LINEUP } from "@/lib/league-value";
import { eligible, entriesFor, type ResearchEntry } from "@/lib/research-scoring";
import { playersSnapshot } from "@/lib/snapshots";
import { startSitCall } from "@/lib/start-sit";

const STORAGE_KEY = "opportunity-start-sit";
const MAX_PLAYERS = 4;
const genericSettings = { rec: 1, pass_int: -2 };
const positionLabel = (position: string) => (position === "DEF" ? "DST" : position);
const teamLabel = (team: string) => (team === "LA" ? "LAR" : team);

/** Type a name, pick from the matches. */
function PlayerPicker({
  entries,
  taken,
  mine,
  onPick,
}: {
  entries: ResearchEntry[];
  taken: Set<string>;
  mine: Set<string>;
  onPick: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const query = text.toLowerCase().trim();
  const matches = query
    ? entries
        .filter(
          (e) => !taken.has(e.id) && `${e.name} ${teamLabel(e.team)}`.toLowerCase().includes(query),
        )
        .sort(
          (a, b) =>
            Number(mine.has(b.sleeperId)) - Number(mine.has(a.sleeperId)) ||
            b.weekPoints - a.weekPoints,
        )
        .slice(0, 8)
    : [];
  return (
    <div className="relative">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) {
            onPick(matches[0].id);
            setText("");
          }
        }}
        placeholder="Type a player's name"
        aria-label="Add a player to compare"
      />
      {matches.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover text-sm shadow-lg">
          {matches.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent"
                onClick={() => {
                  onPick(e.id);
                  setText("");
                }}
              >
                <span className="font-semibold">{e.name}</span>
                <span className="text-xs text-muted-foreground">
                  {positionLabel(e.position)} · {teamLabel(e.team)}
                  {mine.has(e.sleeperId) && " · my roster"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && matches.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">No player with a projection matches.</p>
      )}
    </div>
  );
}

export function StartSit() {
  const league = useLeague();
  const settings = useMemo(
    () => league.selected?.scoring_settings ?? genericSettings,
    [league.selected],
  );
  const entries = useMemo(() => entriesFor(settings), [settings]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const { injuryOf, ifPlays, chances, chanceOf, expectedFor } = useWeekOutlook(entries, settings);
  const weatherFor = useWeather(playersSnapshot.week);
  const weekStatus = useWeekStatus(playersSnapshot.week);
  const [cardId, setCardId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
      if (Array.isArray(saved)) setPicked(saved.filter((id) => typeof id === "string"));
    } catch {
      // No saved comparison.
    }
  }, []);
  const update = (ids: string[]) => {
    setPicked(ids);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // Storage unavailable: the comparison lasts for this visit.
    }
  };
  const myRoster = league.rosters.find((r) => String(r.owner_id) === league.userId);
  const mine = useMemo(() => new Set(myRoster?.players ?? []), [myRoster]);
  const slots = league.selected?.roster_positions ?? DEFAULT_LINEUP;

  const chosen = picked.flatMap((id) => byId.get(id) ?? []);
  const taken = new Set(chosen.map((e) => e.id));
  const ranked = [...chosen].sort(
    (a, b) => expectedFor(b) - expectedFor(a) || a.id.localeCompare(b.id),
  );
  const [best, next] = ranked;
  const gap = best && next ? expectedFor(best) - expectedFor(next) : 0;
  const call = startSitCall(gap);
  const shareSlot = (a: ResearchEntry, b: ResearchEntry) =>
    slots.some((slot) => eligible(a.position, slot) && eligible(b.position, slot));
  const mismatch = best && ranked.slice(1).find((other) => !shareSlot(best, other));
  const myPlayers = entries
    .filter((e) => mine.has(e.sleeperId) && !taken.has(e.id))
    .sort((a, b) => expectedFor(b) - expectedFor(a));

  return (
    <div className="space-y-4">
      {weekStatus.weekOver && <WeekOverStrip week={playersSnapshot.week} />}
      <section className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="broadcast-tag text-xs uppercase">
          {playersSnapshot.season} · Week {playersSnapshot.week} start / sit
        </p>
        <p className="text-xs text-muted-foreground">
          {league.selected ? `${league.selected.name} scoring` : "Full PPR scoring"}
        </p>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-full max-w-xs">
            {chosen.length < MAX_PLAYERS ? (
              <PlayerPicker
                entries={entries}
                taken={taken}
                mine={mine}
                onPick={(id) => update([...picked.filter((p) => byId.has(p)), id])}
              />
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                Comparing {MAX_PLAYERS} players. Remove one to add another.
              </p>
            )}
          </div>
          {chosen.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => update([])}>
              Clear
            </Button>
          )}
        </div>
        {myPlayers.length > 0 && chosen.length < MAX_PLAYERS && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">My roster:</span>
            {myPlayers.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => update([...picked.filter((p) => byId.has(p)), e.id])}
                className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:border-primary hover:bg-accent"
              >
                {e.name}{" "}
                {e.position !== "DEF" && (
                  <span className="text-muted-foreground">{e.position}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {chosen.length < 2 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {chosen.length === 0
            ? "Pick two players (up to four) to see who to start this week."
            : "Pick one more player to compare."}
        </p>
      ) : (
        <section className="rounded-lg border-2 border-volt bg-card p-4" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {call.call}
          </p>
          <p className="mt-1 font-display text-2xl md:text-3xl">
            Start {best!.name}
            {ranked.length === 2 ? ` over ${next!.name}` : ""}
          </p>
          <p className="mt-2 text-sm leading-6">
            We expect {gap.toFixed(1)} more points from him than from{" "}
            {ranked.length === 2 ? next!.name : `the next best, ${next!.name}`}. In past seasons,
            the player we favored by this much outscored the other about{" "}
            <strong>{Math.round(call.rate * 100)} times in 100</strong>.
          </p>
          {mismatch && (
            <p className="mt-2 text-sm text-warning">
              {best!.name} and {mismatch.name} cannot fill the same lineup spot in this league, so
              this may not be a real either/or.
            </p>
          )}
        </section>
      )}

      {chosen.length > 0 && (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {ranked.map((entry, index) => {
            const injury = injuryOf(entry);
            const out = RULED_OUT.has(injury?.status ?? "");
            const chance = chanceOf(entry);
            const winner = ranked.length > 1 && index === 0;
            return (
              <article
                key={entry.id}
                className={`relative rounded-lg border bg-card p-4 ${winner ? "border-volt" : ""} ${out ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" : ""}`}
              >
                <button
                  type="button"
                  aria-label={`Remove ${entry.name}`}
                  onClick={() => update(picked.filter((id) => id !== entry.id))}
                  className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
                {ranked.length > 1 && (
                  <p
                    className={`text-xs font-bold uppercase tracking-wide ${winner ? "text-volt" : "text-muted-foreground"}`}
                  >
                    {winner ? "Start" : "Sit"}
                  </p>
                )}
                <p className="pr-6 font-semibold">
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
                  {injury && INJURY_LETTER[injury.status] && (
                    <span
                      title={[injury.status, injury.body].filter(Boolean).join(" · ")}
                      className="ml-2 font-sans text-sm font-extrabold text-red-600 dark:text-red-400"
                    >
                      {INJURY_LETTER[injury.status]}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {positionLabel(entry.position)} · {teamLabel(entry.team)} vs {entry.opponent}
                  {weekStatus.gameOver(entry.team) && " · game over"}
                  <WeatherIcons weather={weatherFor(entry.team)} />
                </p>
                <p className="mt-3 font-display text-4xl tabular-nums">
                  {expectedFor(entry).toFixed(1)}
                  <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">
                    expected pts
                  </span>
                </p>
                {chance < 0.9 && (
                  <p className={`text-xs ${chance < 0.5 ? "" : "text-warning"}`}>
                    {ifPlays(entry).toFixed(1)} if he plays · {Math.round(chance * 100)}% chance to
                    play ({chances.get(entry.id)?.reason})
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">{entry.detail}</p>
              </article>
            );
          })}
        </section>
      )}

      <details className="text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer text-primary">How the call is made</summary>
        <ul className="mt-2 list-disc space-y-1 rounded-md border bg-card p-3 pl-7">
          <li>
            Expected points are our projection in this league's scoring, times the chance he plays
            when there is an injury doubt. The same numbers rank the Weekly board.
          </li>
          <li>
            The "times in 100" comes from checking our model against 2019 to 2025 results: under a 1
            point gap it is close to a coin flip (52), and even an 8 point gap loses about 1 time in
            4. Big misses are part of the game.
          </li>
        </ul>
      </details>

      {projectionById.has(cardId) &&
        (() => {
          const card = byId.get(cardId)!;
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
                  value:
                    `${ifPlays(card).toFixed(1)} pts` +
                    (chanceOf(card) < 0.9 ? ` · ${Math.round(chanceOf(card) * 100)}% to play` : ""),
                },
                {
                  label: "Rest of season",
                  value: card.rosPoints == null ? "—" : `${card.rosPoints.toFixed(0)} pts`,
                },
              ]}
            />
          );
        })()}
    </div>
  );
}
