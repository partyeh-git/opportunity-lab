// Saves Sleeper player notes as they come in, so the app keeps a full-season history.
// Sleeper's public news feed only returns each player's 10 newest notes, so this runs daily
// (see .github/workflows/archive-notes.yml) and merges anything new into
// public/notes/<sleeperId>.json, newest first. Notes are display only; the model never reads them.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUT = new URL("../public/notes/", import.meta.url);
const snapshot = JSON.parse(
  await readFile(new URL("../src/data/rankings-current.json", import.meta.url), "utf8"),
);
const ids = [...new Set(snapshot.players.map((p) => p.sleeperId).filter(Boolean))];

const keyOf = (note) => `${note.source}:${note.source_key ?? note.published}`;
const slim = (note) => ({
  published: note.published,
  source: note.source,
  source_key: note.source_key,
  metadata: {
    title: note.metadata?.title,
    description: note.metadata?.description,
    analysis: note.metadata?.analysis,
    url: note.metadata?.url,
  },
});

async function fetchNotes(id) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(`https://api.sleeper.com/players/nfl/${id}/news?limit=10`);
    if (response.ok) return response.json();
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
  throw new Error(`Sleeper news failed for player ${id}`);
}

async function archive(id) {
  const file = new URL(`${id}.json`, OUT);
  let saved = [];
  try {
    saved = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // First time we have seen this player.
  }
  const known = new Set(saved.map(keyOf));
  const fresh = (await fetchNotes(id)).filter((note) => !known.has(keyOf(note))).map(slim);
  if (!fresh.length) return 0;
  const merged = [...fresh, ...saved].sort((a, b) => b.published - a.published);
  // One note per line: compact, and daily changes read cleanly in git.
  await writeFile(file, `[\n${merged.map((note) => JSON.stringify(note)).join(",\n")}\n]\n`);
  return fresh.length;
}

await mkdir(OUT, { recursive: true });
let added = 0;
let failed = 0;
// A few players at a time keeps us polite to Sleeper.
for (let i = 0; i < ids.length; i += 5) {
  const results = await Promise.allSettled(ids.slice(i, i + 5).map(archive));
  for (const result of results) {
    if (result.status === "fulfilled") added += result.value;
    else {
      failed++;
      console.error(result.reason.message);
    }
  }
}
console.log(`Checked ${ids.length} players: ${added} new notes saved, ${failed} failed.`);
if (failed > ids.length / 2) process.exit(1);
