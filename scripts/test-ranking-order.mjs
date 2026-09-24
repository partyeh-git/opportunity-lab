import assert from "node:assert/strict";
import {
  moveToRank,
  parseOrder,
  rankingStorageKey,
  reconcileOrder,
} from "../src/lib/ranking-order.ts";

// Reordering in a filtered list moves only the selected player. Hidden players survive.
const all = ["qb1", "rb1", "wr1", "rb2", "te1"];
const moved = moveToRank(all, "rb2", all.indexOf("rb1") + 1);
assert.deepEqual(moved, ["qb1", "rb2", "rb1", "wr1", "te1"]);
assert.deepEqual(all, ["qb1", "rb1", "wr1", "rb2", "te1"]);
assert.deepEqual(moveToRank(moved, "rb2", 5), ["qb1", "rb1", "wr1", "te1", "rb2"]);
assert.deepEqual(moveToRank(all, "unknown", 1), all);
assert.deepEqual(moveToRank(all, "rb2", NaN), all);
assert.deepEqual(moveToRank(all, "rb2", -1), ["rb2", "qb1", "rb1", "wr1", "te1"]);
// Saved order can survive a model refresh without duplicates, retired IDs, or dropped newcomers.
assert.deepEqual(reconcileOrder(["rb2", "gone", "rb2", "qb1"], all), [
  "rb2",
  "qb1",
  "rb1",
  "wr1",
  "te1",
]);
assert.deepEqual(parseOrder("invalid"), []);
assert.deepEqual(parseOrder('{"ids":[]}'), []);
assert.deepEqual(parseOrder('["rb1",3]'), []);
assert.deepEqual(parseOrder(JSON.stringify(moved)), moved);
const key = (week = 3, horizon = "ros", league = "one", settings = { rec: 1, pass_td: 4 }) =>
  rankingStorageKey(2026, week, horizon, league, settings, false);
assert.equal(key(3), key(4), "ROS manual preferences survive weekly refreshes");
assert.notEqual(key(3, "week"), key(4, "week"), "Weekly orders are separate");
assert.notEqual(key(), key(3, "ros", "two"), "Leagues must not share overrides");
assert.notEqual(
  key(),
  key(3, "ros", "one", { rec: 0.5, pass_td: 4 }),
  "Scoring formats must not share overrides",
);
assert.equal(
  key(),
  key(3, "ros", "one", { pass_td: 4, rec: 1 }),
  "Key order must not reset preferences",
);
assert.notEqual(
  rankingStorageKey(2026, 3, "week", "one", { rec: 1 }, false, "QB"),
  rankingStorageKey(2026, 3, "week", "one", { rec: 1 }, false, "RB"),
  "Weekly position boards keep separate orders",
);
assert.equal(
  rankingStorageKey(2026, 3, "ros", "one", { rec: 1 }, false),
  'opportunity-ranking-v1:2026:ros:one:players:[["rec",1]]',
  "ROS keys stay unchanged so saved season orders survive",
);
console.log("Saved ranking order checks passed.");
