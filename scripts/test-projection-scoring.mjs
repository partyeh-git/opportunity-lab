import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreProjectedStats, scoreRemainingGames } from "../src/lib/projection-scoring.ts";

const blank = {
  passingYards: 0,
  passingTds: 0,
  passingInterceptions: 0,
  rushingYards: 0,
  rushingTds: 0,
  receivingYards: 0,
  receivingTds: 0,
  receptions: 0,
  fumblesLost: 0,
  passing2pt: 0,
  rushing2pt: 0,
  receiving2pt: 0,
  specialTeamsTds: 0,
  fumbleRecoveryTds: 0,
};
const player = {
  weeklyForecasts: [
    { week: 3, projected: { ...blank, rushingYards: 100, receptions: 4 } },
    { week: 5, projected: { ...blank, rushingYards: 40, receptions: 2 } },
  ],
};
assert.equal(scoreRemainingGames(player, { rec: 1 }), 20);
assert.equal(scoreRemainingGames(player, { rec: 0.5 }), 17);
assert.equal(scoreRemainingGames(player, { rec: 1 }, 4), 14);
assert.equal(scoreProjectedStats({ ...blank, passingInterceptions: 2 }, { pass_int: 0 }), 0);
assert.equal(scoreProjectedStats({ ...blank, passingInterceptions: 2 }, { pass_int: -1 }), -2);
const snapshot = JSON.parse(
  readFileSync(new URL("../src/data/rankings-current.json", import.meta.url), "utf8"),
);
for (const p of snapshot.players) {
  assert.equal(new Set(p.weeklyForecasts.map((g) => g.week)).size, p.remainingGames);
  assert.ok(Math.abs(scoreRemainingGames(p, { rec: 1 }) - p.rosFull) < 0.002);
  assert.ok(Math.abs(scoreRemainingGames(p, { rec: 0.5 }) - p.rosHalf) < 0.002);
  assert.ok(Math.abs(scoreProjectedStats(p.projected, { rec: 1 }) - p.weekFull) < 0.002);
}
const weekly = [...snapshot.players].sort((a, b) => b.weekFull - a.weekFull).map((p) => p.id);
const ros = [...snapshot.players].sort((a, b) => b.rosFull - a.rosFull).map((p) => p.id);
assert.notDeepEqual(weekly, ros, "Current snapshot should reflect its distinct future schedule");
console.log(
  `Scoring checks passed for ${snapshot.players.length} players; future games are rescored individually.`,
);
