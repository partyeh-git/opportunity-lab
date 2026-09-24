import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import playersSnapshot from "@/data/rankings-current.json";
import { scoreProjectedStats } from "@/lib/projection-scoring";

type Projection = (typeof playersSnapshot.players)[number];
type Projected = Projection["weeklyForecasts"][number]["projected"];
type GameStats = Record<string, number>;
type SleeperGame = {
  week: number;
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

const s = (stats: GameStats, key: string) => stats[key] ?? 0;

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
  const cols = columns[player.position] ?? columns["WR"]!;
  const games = Object.values(log.data ?? {})
    .filter((g): g is NonNullable<SleeperGame> => !!g && s(g.stats, "gp") > 0)
    .sort((a, b) => a.week - b.week);
  const playedPoints = games.map((g) => gamePoints(g.stats, settings, connected));
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
            <section className="space-y-1 rounded-md border border-warning/40 bg-warning-soft/60 p-3 text-xs leading-5">
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
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
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

function StatTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-broadcast text-broadcast-foreground">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={`px-2 py-1.5 font-semibold ${i > 1 ? "text-right" : "text-left"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[0])} className="border-t">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={`px-2 py-1.5 ${i > 1 ? "text-right" : ""} ${i === 2 ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
