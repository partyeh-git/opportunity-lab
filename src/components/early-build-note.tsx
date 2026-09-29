import type { PlayersSnapshot } from "@/lib/snapshots";

const teamLabel = (team: string) => (team === "LA" ? "LAR" : team);

/** Shown on season-long pages while they run on the early (Monday morning) build. */
export function EarlyBuildNote({ snapshot }: { snapshot: PlayersSnapshot }) {
  const pending = snapshot.pendingTeams;
  if (!pending) return null;
  return (
    <p className="rounded-md border border-volt/40 bg-card px-3 py-2 text-sm">
      <strong>Updated with Week {snapshot.week - 1}'s games.</strong>{" "}
      {pending.length > 0
        ? `${pending.map(teamLabel).join(" and ")} have not played yet; their players update Tuesday morning.`
        : "Final update Tuesday morning."}
    </p>
  );
}
