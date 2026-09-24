// Saves each ranked player's current Sleeper injury designation to public/injuries.json, so the
// rankings can show the familiar red Q / D / O / IR letters without loading Sleeper's full
// 15MB player list in the browser. Runs with the notes job (.github/workflows/archive-notes.yml).
import { readFile, writeFile } from "node:fs/promises";

const snapshot = JSON.parse(
  await readFile(new URL("../src/data/rankings-current.json", import.meta.url), "utf8"),
);
const ids = new Set(snapshot.players.map((p) => p.sleeperId).filter(Boolean));

const response = await fetch("https://api.sleeper.app/v1/players/nfl");
if (!response.ok) throw new Error(`Sleeper players failed: ${response.status}`);
const all = await response.json();

const players = {};
for (const id of [...ids].sort()) {
  const p = all[id];
  if (!p?.injury_status) continue;
  players[id] = {
    status: p.injury_status,
    body: p.injury_body_part ?? null,
    practice: p.practice_participation ?? null,
  };
}
const file = new URL("../public/injuries.json", import.meta.url);
const next = JSON.stringify({ players }, null, 1);
let previous = "";
try {
  previous = JSON.stringify({ players: JSON.parse(await readFile(file, "utf8")).players }, null, 1);
} catch {
  // First run.
}
// Only rewrite (and so only commit) when a designation actually changed.
if (next !== previous) {
  await writeFile(
    file,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), players }, null, 1)}\n`,
  );
}
console.log(
  `${Object.keys(players).length} ranked players have an injury designation${next === previous ? " (no change)" : ""}.`,
);
