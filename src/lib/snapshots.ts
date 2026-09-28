// Weekly player and DST projections. Loaded once at startup (see loadSnapshots) instead of being
// packed into the page code, so the Tuesday refresh reaches the site without a republish and the
// page stays light. Read these only after the app has finished loading them.
import { fetchLiveJson } from "@/lib/live-data";
import type PlayersFile from "@/data/rankings-current.json";
import type DefensesFile from "@/data/dst-current.json";

export type PlayersSnapshot = typeof PlayersFile;
export type DefensesSnapshot = typeof DefensesFile;

export let playersSnapshot = undefined as unknown as PlayersSnapshot;
export let defensesSnapshot = undefined as unknown as DefensesSnapshot;

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
  playersSnapshot = players;
  defensesSnapshot = defenses;
  return true;
}
