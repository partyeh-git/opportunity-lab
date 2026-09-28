import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, StickyNote } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { playersSnapshot, type PlayersSnapshot } from "@/lib/snapshots";
import { fetchPublicJson } from "@/lib/live-data";
import { scoreProjectedStats } from "@/lib/projection-scoring";

type Projection = PlayersSnapshot["players"][number];
type Projected = Projection["weeklyForecasts"][number]["projected"];
type GameStats = Record<string, number>;
type SleeperGame = {
  week: number;
  date: string;
  opponent: string;
  is_away_team: boolean;
  stats: GameStats;
} | null;
type SleeperPlayer = {
  number?: number;
  age?: number;
  years_exp?: number;
  status?: string;
  depth_chart_position?: string | null;
  depth_chart_order?: number | null;
  injury_status?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
  practice_participation?: string | null;
  practice_description?: string | null;
};

type SleeperNote = {
  published: number;
  source: string;
  source_key?: string;
  metadata: { title?: string; description?: string; analysis?: string; url?: string };
};

const s = (stats: GameStats, key: string) => stats[key] ?? 0;
const DAY = 24 * 60 * 60 * 1000;
const sourceName = (source: string) =>
  source === "fantasy_pros" ? "FantasyPros" : source.replace(/_/g, " ");

/** One news note: headline, what happened, and the writer's fantasy take, with its source. */
function Note({ note }: { note: SleeperNote }) {
  const { title, description, analysis, url } = note.metadata;
  const label = `${sourceName(note.source)} via Sleeper`;
  return (
    <article className="space-y-1.5 py-4 text-sm leading-6">
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && <p className="text-foreground/85">{description}</p>}
      {analysis && <p className="border-l-2 border-border pl-3 text-foreground/75">{analysis}</p>}
      <p className="text-xs text-muted-foreground">
        {new Date(note.published).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
        ·{" "}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-primary">
            {label}
          </a>
        ) : (
          label
        )}
      </p>
    </article>
  );
}

/** Stat columns per position: how to read a real game line and one of our projections. */
const columns: Record<
  string,
  { label: string; actual: (g: GameStats) => number; projected: (p: Projected) => number }[]
> = {
  QB: [
    { label: "Cmp/Att", actual: () => 0, projected: () => 0 },
    { label: "Pass yd", actual: (g) => s(g, "pass_yd"), projected: (p) => p.passingYards },
    { label: "Pass TD", actual: (g) => s(g, "pass_td"), projected: (p) => p.passingTds },
    { label: "INT", actual: (g) => s(g, "pass_int"), projected: (p) => p.passingInterceptions },
    { label: "Rush yd", actual: (g) => s(g, "rush_yd"), projected: (p) => p.rushingYards },
  ],
  RB: [
    { label: "Car", actual: (g) => s(g, "rush_att"), projected: (p) => p.carries },
    { label: "Rush yd", actual: (g) => s(g, "rush_yd"), projected: (p) => p.rushingYards },
    { label: "Tgt", actual: (g) => s(g, "rec_tgt"), projected: (p) => p.targets },
    { label: "Rec", actual: (g) => s(g, "rec"), projected: (p) => p.receptions },
    { label: "Rec yd", actual: (g) => s(g, "rec_yd"), projected: (p) => p.receivingYards },
    {
      label: "TD",
      actual: (g) => s(g, "rush_td") + s(g, "rec_td"),
      projected: (p) => p.rushingTds + p.receivingTds,
    },
  ],
  WR: [
    { label: "Tgt", actual: (g) => s(g, "rec_tgt"), projected: (p) => p.targets },
    { label: "Rec", actual: (g) => s(g, "rec"), projected: (p) => p.receptions },
    { label: "Rec yd", actual: (g) => s(g, "rec_yd"), projected: (p) => p.receivingYards },
    {
      label: "TD",
      actual: (g) => s(g, "rec_td") + s(g, "rush_td"),
      projected: (p) => p.receivingTds + p.rushingTds,
    },
    { label: "Rush yd", actual: (g) => s(g, "rush_yd"), projected: (p) => p.rushingYards },
  ],
};
columns["TE"] = columns["WR"]!;

/** Fantasy points for a real game line, scored stat by stat with the league's settings,
 * the same way Sleeper scores it. Without a connected league, uses Sleeper's own PPR totals. */
function gamePoints(stats: GameStats, settings: Record<string, number>, connected: boolean) {
  if (!connected) return settings["rec"] === 0.5 ? s(stats, "pts_half_ppr") : s(stats, "pts_ppr");
  return Object.entries(settings).reduce(
    (sum, [key, weight]) => sum + (stats[key] ?? 0) * weight,
    0,
  );
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sleeper returned ${response.status}`);
  return (await response.json()) as T;
}

export function PlayerCard({
  player,
  settings,
  connected,
  summary,
  open,
  onOpenChange,
}: {
  player: Projection;
  settings: Record<string, number>;
  connected: boolean;
  summary: { label: string; value: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [season, setSeason] = useState(playersSnapshot.season);
  const info = useQuery({
    queryKey: ["sleeper-player", player.sleeperId],
    queryFn: () =>
      getJson<SleeperPlayer>(`https://api.sleeper.com/players/nfl/${player.sleeperId}`),
    enabled: open && !!player.sleeperId,
    staleTime: 10 * 60 * 1000,
  });
  const log = useQuery({
    queryKey: ["sleeper-log", player.sleeperId, season],
    queryFn: () =>
      getJson<Record<string, SleeperGame>>(
        `https://api.sleeper.com/stats/nfl/player/${player.sleeperId}?season_type=regular&season=${season}&grouping=week`,
      ),
    enabled: open && !!player.sleeperId,
    staleTime: 10 * 60 * 1000,
  });
  const news = useQuery({
    queryKey: ["sleeper-news", player.sleeperId],
    queryFn: () =>
      getJson<SleeperNote[]>(
        `https://api.sleeper.com/players/nfl/${player.sleeperId}/news?limit=30`,
      ),
    enabled: open && !!player.sleeperId,
    staleTime: 10 * 60 * 1000,
  });
  // Sleeper's feed only has the 10 newest notes; a daily job saves older ones in the app
  // (scripts/archive-notes.mjs). Merge both so the card shows the whole season.
  const archive = useQuery({
    queryKey: ["notes-archive", player.sleeperId],
    queryFn: async () => {
      return (await fetchPublicJson<SleeperNote[]>(`notes/${player.sleeperId}.json`)) ?? [];
    },
    enabled: open && !!player.sleeperId,
    staleTime: 10 * 60 * 1000,
  });
  const noteKey = (n: SleeperNote) => `${n.source}:${n.source_key ?? n.published}`;
  const notes = [
    ...new Map(
      [...(archive.data ?? []), ...(news.data ?? [])].map((n) => [noteKey(n), n]),
    ).values(),
  ].sort((a, b) => b.published - a.published);
  const cols = columns[player.position] ?? columns["WR"]!;
  const games = Object.values(log.data ?? {})
    .filter((g): g is NonNullable<SleeperGame> => !!g && s(g.stats, "gp") > 0)
    .sort((a, b) => a.week - b.week);
  const playedPoints = games.map((g) => gamePoints(g.stats, settings, connected));
  // A game's notes: anything published from game day through two days after (recaps and
  // next-day injury updates). Saved notes start in September 2026, so older games have none.
  const gameNotes = games.map((g) => {
    const start = new Date(`${g.date}T00:00:00`).getTime();
    return notes.filter((n) => n.published >= start && n.published < start + 3 * DAY);
  });
  const average = playedPoints.length
    ? playedPoints.reduce((a, b) => a + b, 0) / playedPoints.length
    : null;
  const forecastByWeek = new Map(player.weeklyForecasts.map((g) => [g.week, g]));
  const upcoming = Array.from(
    { length: 18 - playersSnapshot.week + 1 },
    (_, i) => playersSnapshot.week + i,
  );
  const sleeper = info.data;
  const injury = [sleeper?.injury_status, sleeper?.injury_body_part].filter(Boolean).join(" · ");
  const practice = sleeper?.practice_description ?? sleeper?.practice_participation;
  const flagged = player.availability && player.availability.state !== "unverified";
  // Real games are whole numbers; projected touchdowns and interceptions keep a decimal.
  const fmt = (n: number, label: string, projected = false) =>
    projected && ["Pass TD", "TD", "INT"].includes(label) ? n.toFixed(1) : n.toFixed(0);
  const team = (t: string) => (t === "LA" ? "LAR" : t);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-3xl">{player.name}</SheetTitle>
          <SheetDescription className="text-sm">
            {player.position} · {player.team}
            {sleeper?.number != null && ` · #${sleeper.number}`}
            {sleeper?.age != null && ` · Age ${sleeper.age}`}
            {sleeper?.years_exp != null && ` · Year ${sleeper.years_exp + 1}`}
            {sleeper?.depth_chart_position &&
              sleeper.depth_chart_order != null &&
              ` · Depth chart ${sleeper.depth_chart_position}${sleeper.depth_chart_order}`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5 text-sm">
          {(injury || flagged || practice || sleeper?.injury_notes) && (
            <section className="space-y-1 rounded-md border border-warning/40 bg-warning-soft/60 p-3 text-sm leading-6">
              {injury && (
                <p>
                  <span className="font-semibold text-foreground">Sleeper status:</span> {injury}
                  {practice && ` · Practice: ${practice}`}
                </p>
              )}
              {sleeper?.injury_notes && <p>{sleeper.injury_notes}</p>}
              {flagged && (
                <p>
                  <span className="font-semibold text-foreground">In our projections:</span>{" "}
                  {player.availability.label}
                  {player.availability.outWeeks.length > 0 &&
                    `, counted as zero in Week${player.availability.outWeeks.length > 1 ? "s" : ""} ${player.availability.outWeeks.join(", ")}`}
                  .
                </p>
              )}
            </section>
          )}

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ...summary,
              {
                label: `${season} average`,
                value: average == null ? "—" : `${average.toFixed(1)} pts`,
              },
            ].map((tile) => (
              <div key={tile.label} className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">{tile.label}</p>
                <p className="mt-1 font-display text-2xl">{tile.value}</p>
              </div>
            ))}
          </section>

          {notes.length > 0 && (
            <section>
              <h3 className="mb-2 font-display text-lg">
                Notes <span className="text-sm text-muted-foreground">· {notes.length}</span>
              </h3>
              <div className="max-h-[28rem] divide-y overflow-y-auto rounded-md border px-4">
                {notes.map((note) => (
                  <Note key={noteKey(note)} note={note} />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-lg">Game log</h3>
              <select
                value={season}
                onChange={(e) => setSeason(Number(e.target.value))}
                aria-label="Season"
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                {[0, 1, 2].map((back) => (
                  <option key={back} value={playersSnapshot.season - back}>
                    {playersSnapshot.season - back}
                  </option>
                ))}
              </select>
            </div>
            {log.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading games from Sleeper…</p>
            ) : log.isError ? (
              <p className="text-xs text-warning">Sleeper game stats could not be loaded.</p>
            ) : games.length === 0 ? (
              <p className="text-xs text-muted-foreground">No games played in {season}.</p>
            ) : (
              <StatTable
                headers={["Wk", "Opp", "Pts", "Snap %", ...cols.map((c) => c.label)]}
                rows={games.map((g, i) => [
                  g.week,
                  `${g.is_away_team ? "@" : "vs"} ${team(g.opponent)}`,
                  playedPoints[i]!.toFixed(1),
                  s(g.stats, "tm_off_snp")
                    ? `${((s(g.stats, "off_snp") / s(g.stats, "tm_off_snp")) * 100).toFixed(0)}%`
                    : "—",
                  ...cols.map((c) =>
                    c.label === "Cmp/Att"
                      ? `${s(g.stats, "pass_cmp")}/${s(g.stats, "pass_att")}`
                      : fmt(c.actual(g.stats), c.label),
                  ),
                ])}
                details={gameNotes.map((list) =>
                  list.length ? (
                    <div className="space-y-3">
                      {list.map((note) => (
                        <Note key={noteKey(note)} note={note} />
                      ))}
                    </div>
                  ) : null,
                )}
              />
            )}
          </section>

          <section>
            <h3 className="mb-2 font-display text-lg">Rest of season · our projections</h3>
            <StatTable
              headers={["Wk", "Opp", "Proj", ...cols.map((c) => c.label)]}
              rows={upcoming.map((week) => {
                const game = forecastByWeek.get(week);
                if (!game) return [week, "Bye", "—", ...cols.map(() => "")];
                const out = game.availability === "out";
                return [
                  week,
                  team(game.opponent),
                  out ? "Out" : scoreProjectedStats(game.projected, settings).toFixed(1),
                  ...cols.map((c) =>
                    out
                      ? ""
                      : c.label === "Cmp/Att"
                        ? `${game.projected.completions.toFixed(0)}/${game.projected.passingAttempts.toFixed(0)}`
                        : fmt(c.projected(game.projected), c.label, true),
                  ),
                ];
              })}
            />
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Projected in {connected ? "your league's" : "the selected"} scoring. Assumes the
              player plays unless ruled out; later-season matchup effects fade toward average. Past
              game stats come from Sleeper.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Stat table. Rows with details get a note icon and expand below when clicked. */
function StatTable({
  headers,
  rows,
  details,
}: {
  headers: string[];
  rows: (string | number)[][];
  details?: (ReactNode | null)[];
}) {
  const [openRow, setOpenRow] = useState<number | null>(null);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm tabular-nums">
        <thead className="bg-broadcast text-broadcast-foreground">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={`px-2.5 py-2 font-semibold ${i > 1 ? "text-right" : "text-left"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const detail = details?.[r];
            const expanded = openRow === r;
            return (
              <Fragment key={String(row[0])}>
                <tr
                  className={`border-t ${detail ? "cursor-pointer hover:bg-accent/50" : ""}`}
                  onClick={detail ? () => setOpenRow(expanded ? null : r) : undefined}
                  aria-expanded={detail ? expanded : undefined}
                >
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={`px-2.5 py-2 ${i > 1 ? "text-right" : ""} ${i === 2 ? "font-semibold text-foreground" : "text-foreground/80"}`}
                    >
                      {i === 0 && detail ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          {expanded ? (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {cell}
                          <StickyNote className="h-3.5 w-3.5" aria-label="Has notes" />
                        </span>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
                {detail && expanded && (
                  <tr className="bg-muted/40">
                    <td colSpan={row.length} className="px-3 py-3">
                      {detail}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
