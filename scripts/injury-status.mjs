// Saves each ranked player's current Sleeper injury designation to public/injuries.json, so the
// rankings can show the familiar red Q / D / O / IR letters without loading Sleeper's full
// 15MB player list in the browser. Runs with the notes job (.github/workflows/archive-notes.yml).
// Also saves each player's final practice level of the week (did not practice, limited, full) from
// the NFL injury reports (nflverse; Sleeper carries no practice data). The chance-to-play rates
// were measured on the final practice level, so a team's practice levels are saved only once its
// game designations are posted (Friday, or Wednesday before a Thursday game).
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
const LEVELS = {
  "Did Not Participate In Practice": "DNP",
  "Limited Participation in Practice": "Limited",
  "Full Participation in Practice": "Full",
};
/** One CSV line to fields (quoted fields may hold commas). */
const fields = (line) =>
  [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)]
    .slice(0, -1)
    .map((m) => m[1].replace(/^"|"$/g, "").replace(/""/g, '"'));
const practice = {};
try {
  const report = await fetch(
    `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${snapshot.season}.csv`,
  );
  if (!report.ok) throw new Error(`injury reports failed: ${report.status}`);
  const [head, ...lines] = (await report.text()).trim().split(/\r?\n/);
  const column = Object.fromEntries(fields(head).map((name, i) => [name, i]));
  const rows = lines
    .map(fields)
    .filter((r) => r[column.game_type] === "REG" && Number(r[column.week]) === snapshot.week);
  const designated = ["Out", "Doubtful", "Questionable"];
  const final = new Set(
    rows.filter((r) => designated.includes(r[column.report_status])).map((r) => r[column.team]),
  );
  const sleeperId = new Map(snapshot.players.map((p) => [p.id, p.sleeperId]));
  for (const r of rows) {
    const id = sleeperId.get(r[column.gsis_id]);
    const level = LEVELS[r[column.practice_status]];
    if (id && level && final.has(r[column.team])) practice[id] = level;
  }
} catch (error) {
  // Practice levels are an extra: keep the designations if the report file cannot be read.
  console.warn(`No practice levels: ${error.message}`);
}
for (const [id, level] of Object.entries(practice)) if (players[id]) players[id].practice = level;

const file = new URL("../public/injuries.json", import.meta.url);
const content = { week: snapshot.week, players, practice };
const next = JSON.stringify(content, null, 1);
let previous = "";
try {
  const { week, players, practice } = JSON.parse(await readFile(file, "utf8"));
  previous = JSON.stringify({ week, players, practice }, null, 1);
} catch {
  // First run.
}
// Only rewrite (and so only commit) when a designation or practice level actually changed.
if (next !== previous) {
  await writeFile(
    file,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), ...content }, null, 1)}\n`,
  );
}
console.log(
  `${Object.keys(players).length} ranked players have an injury designation, ${Object.keys(practice).length} a final practice level${next === previous ? " (no change)" : ""}.`,
);
