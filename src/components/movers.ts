import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPublicJson } from "@/lib/live-data";
import { playersSnapshot, type PlayersSnapshot } from "@/lib/snapshots";

type LastWeekFile = {
  season: number;
  week: number;
  model: string;
  generatedAt: string;
  players: Record<string, { weeks: number[]; full: number[]; half: number[] }>;
};

/** Points a game that count as a real move in a player's outlook. */
export const BIG_MOVE = 2;

/**
 * How much each player's outlook moved since last week's projections: the change in projected
 * points a game over the same remaining weeks. Empty until a new week has been built on the same
 * model version as the week before (a model change moves everyone, which is not news).
 */
export function useMovers(
  settings: Record<string, number>,
  snapshot: PlayersSnapshot = playersSnapshot,
) {
  const file = useQuery({
    queryKey: ["last-week"],
    queryFn: () => fetchPublicJson<LastWeekFile>("last-week.json"),
    staleTime: 30 * 60 * 1000,
  });
  return useMemo(() => {
    const moves = new Map<string, number>();
    const last = file.data;
    if (
      !last ||
      last.season !== snapshot.season ||
      last.week !== snapshot.week - 1 ||
      last.model !== snapshot.model
    )
      return moves;
    const scoring = (settings["rec"] ?? 1) >= 0.75 ? "full" : "half";
    for (const player of snapshot.players) {
      const before = last.players[player.id];
      if (!before) continue;
      let was = 0;
      let now = 0;
      let games = 0;
      for (const game of player.weeklyForecasts) {
        const i = before.weeks.indexOf(game.week);
        if (i < 0) continue;
        was += before[scoring][i]!;
        now += game[scoring];
        games += 1;
      }
      if (games) moves.set(player.id, (now - was) / games);
    }
    return moves;
  }, [file.data, settings, snapshot]);
}
