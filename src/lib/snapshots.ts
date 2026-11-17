// Weekly player and DST projections. Loaded once at startup (see loadSnapshots) instead of being
// packed into the page code, so the Tuesday refresh reaches the site without a republish and the
// page stays light. Read these only after the app has finished loading them.
import { fetchLiveJson } from "@/lib/live-data";
import type PlayersFile from "@/data/rankings-current.json";
import type DefensesFile from "@/data/dst-current.json";

export type PlayersSnapshot = typeof PlayersFile & {
  /** Early build only: teams whose game last week had not been played when it was made. */
  pendingTeams?: string[];
};
export type DefensesSnapshot = typeof DefensesFile;

export let playersSnapshot = undefined as unknown as PlayersSnapshot;
export let defensesSnapshot = undefined as unknown as DefensesSnapshot;
/**
 * What the season-long pages (overall, trades, waivers) read. Normally the same as
 * playersSnapshot. From Monday morning until the week's last game is final it is next week's
 * early build, so advice counts Sunday's games while the weekly pages stay on the week in progress.
 */
export let seasonSnapshot = undefined as unknown as PlayersSnapshot;

// A newer file on GitHub must still have the shape this version of the site expects.
const playersOk = (s: PlayersSnapshot) =>
  Array.isArray(s?.players) && typeof s.week === "number" && !!s.availabilitySummary;
const defensesOk = (s: DefensesSnapshot) => Array.isArray(s?.defenses);

export async function loadSnapshots() {
  const [players, defenses] = await Promise.all([
    fetchLiveJson<PlayersSnapshot>(
      "src/data/rankings-current.json",
      async () => (await import("@/data/rankings-current.json")).default as PlayersSnapshot,
      playersOk,
    ),
    fetchLiveJson<DefensesSnapshot>(
      "src/data/dst-current.json",
      async () => (await import("@/data/dst-current.json")).default as DefensesSnapshot,
      defensesOk,
    ),
  ]);
  const next = await fetchLiveJson<PlayersSnapshot | null>(
    "src/data/rankings-next.json",
    async () => null,
    (s) => s === null || playersOk(s),
  );
  playersSnapshot = players;
  defensesSnapshot = defenses;
  seasonSnapshot =
    next && next.season === players.season && next.week === players.week + 1 ? next : players;
  return true;
}

/**
 * Has GitHub got a newer weekly build than the one this page loaded? The small DST file is rebuilt
 * in the same job as the player file, so its build time stands in for both (saves pulling 3MB).
 */
export async function newerSnapshotAvailable(): Promise<boolean> {
  if (!defensesSnapshot) return false;
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/partyeh-git/opportunity-lab/main/src/data/dst-current.json",
      { cache: "no-store" },
    );
    if (!response.ok) return false;
    const latest = (await response.json()) as DefensesSnapshot;
    return (
      typeof latest?.generatedAt === "string" &&
      latest.generatedAt > (defensesSnapshot.generatedAt ?? "")
    );
  } catch {
    return false;
  }
}
