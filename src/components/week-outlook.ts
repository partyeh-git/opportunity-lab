import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPublicJson } from "@/lib/live-data";
import { playersSnapshot, type PlayersSnapshot } from "@/lib/snapshots";
import { chanceReason, chanceToPlay, gameStatus, gamesJustMissed } from "@/lib/availability";
import { scoreProjectedStats } from "@/lib/projection-scoring";
import type { ResearchEntry } from "@/lib/research-scoring";

/** Official game designations, shown as the familiar red letter next to a player's name. */
export const INJURY_LETTER: Record<string, string> = {
  Questionable: "Q",
  Doubtful: "D",
  Out: "O",
  IR: "IR",
  PUP: "PUP",
  Sus: "SUS",
};
export type InjuryInfo = { status: string; body: string | null; practice: string | null };
/** Designations that mean he will not play. */
export const RULED_OUT = new Set(["Out", "IR", "PUP", "Sus"]);

// Built on first use: the projections are loaded at startup, after this module is imported.
type Projection = PlayersSnapshot["players"][number];
const maps = new WeakMap<PlayersSnapshot, Map<string, Projection>>();
/** Player lookup for a snapshot (this week's, or the season pages' early build). */
export function projectionsOf(snapshot: PlayersSnapshot) {
  if (!maps.has(snapshot)) maps.set(snapshot, new Map(snapshot.players.map((p) => [p.id, p])));
  return maps.get(snapshot)!;
}
export const projectionById = {
  get: (id: string) => projectionsOf(playersSnapshot).get(id),
  has: (id: string) => projectionsOf(playersSnapshot).has(id),
};

/**
 * This week's outlook for every player, shared by the Weekly board and Start / Sit so they never
 * disagree: points IF he plays, the chance he plays, and the two multiplied (what we rank on;
 * Phase B fix 1: 63.8% to 69.3% start/sit pairs right on 2024).
 */
export function useWeekOutlook(
  entries: ResearchEntry[],
  settings: Record<string, number>,
  snapshot: PlayersSnapshot = playersSnapshot,
) {
  const projectionById = projectionsOf(snapshot);
  // Current designations, refreshed by the notes job several times a day (public/injuries.json).
  // If that file can't load, fall back to the status saved with the projections.
  const injuries = useQuery({
    queryKey: ["injuries"],
    queryFn: async () => {
      const file = await fetchPublicJson<{ players: Record<string, InjuryInfo> }>("injuries.json");
      if (!file) throw new Error("No injury file");
      return file;
    },
    staleTime: 10 * 60 * 1000,
  });
  const injuryOf = (entry: ResearchEntry): InjuryInfo | null => {
    if (injuries.data) return injuries.data.players[entry.sleeperId] ?? null;
    const saved = projectionById.get(entry.id)?.availability;
    return saved && INJURY_LETTER[saved.reportedStatus]
      ? { status: saved.reportedStatus, body: saved.injury || null, practice: null }
      : null;
  };
  // Ruled-out players have a zeroed projection, so use their matchup-neutral line instead.
  const ifPlays = (entry: ResearchEntry) => {
    const p = projectionById.get(entry.id);
    return entry.weekPoints > 0 || !p
      ? entry.weekPoints
      : scoreProjectedStats(p.neutralProjected, settings);
  };
  const chances = useMemo(
    () =>
      new Map(
        entries.map((entry) => {
          const p = projectionById.get(entry.id);
          if (!p) return [entry.id, { value: 1, reason: "" }];
          const info = injuries.data
            ? injuries.data.players[entry.sleeperId]?.status
            : p.availability?.reportedStatus;
          const status = gameStatus(info);
          const missed = gamesJustMissed(p.team, p.lastObservedWeek, snapshot.week);
          return [
            entry.id,
            { value: chanceToPlay(status, missed), reason: chanceReason(status, missed) },
          ];
        }),
      ),
    [entries, injuries.data, projectionById, snapshot],
  );
  const chanceOf = (entry: ResearchEntry) => chances.get(entry.id)?.value ?? 1;
  const expectedFor = (entry: ResearchEntry) => chanceOf(entry) * ifPlays(entry);
  return { injuryOf, ifPlays, chances, chanceOf, expectedFor };
}
