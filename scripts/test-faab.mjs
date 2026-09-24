import assert from "node:assert/strict";
import {
  INJURY_NEWS_MULTIPLIER,
  managerStyles,
  marketFor,
  quantile,
  suggestBid,
  worthDollars,
} from "../src/lib/faab.ts";

assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
assert.equal(quantile([0, 10], 0.7), 7);

// Market: winning bids at the position in the same stretch; falls back to all weeks.
const positions = { a: "RB", b: "RB", c: "WR" };
const win = (playerId, week, bid) => ({ season: 2025, week, ownerId: "x", playerId, bid, won: true, competing: true });
const claims = [win("a", 2, 10), win("a", 3, 20), win("b", 8, 2), win("c", 2, 50)];
assert.deepEqual(marketFor(claims, positions, "RB", true, 2).median, 15);
assert.equal(marketFor(claims, positions, "RB", false, 2).n, 3); // only 1 late RB win, so all RB wins
assert.equal(marketFor(claims, positions, "TE", true), null);

// Worth: 100 rest-of-season points = the whole budget, capped at 60%.
assert.equal(worthDollars(30, 80), 24);
assert.equal(worthDollars(500, 80), 48);
assert.equal(worthDollars(-5, 80), 0);

// Suggested bid is the lower of worth and the price to win.
const market = { n: 20, median: 5, p70: 10, p75: 12, p90: 30, max: 60 };
assert.deepEqual(suggestBid({ worth: 30, market, starterHurt: false, rivals: 2, budgetLeft: 80 }).bid, 10);
const hurt = suggestBid({ worth: 30, market, starterHurt: true, rivals: 2, budgetLeft: 80 });
assert.equal(hurt.priceToWin, Math.round(10 * INJURY_NEWS_MULTIPLIER));
const pricey = suggestBid({ worth: 5, market, starterHurt: false, rivals: 3, budgetLeft: 80 });
assert.equal(pricey.bid, 5);
assert.match(pricey.note, /above his value/);
assert.equal(suggestBid({ worth: 20, market, starterHurt: false, rivals: 0, budgetLeft: 80 }).bid, 1);
assert.equal(suggestBid({ worth: 0, market, starterHurt: true, rivals: 5, budgetLeft: 80 }).bid, 0);
assert.equal(suggestBid({ worth: 40, market, starterHurt: false, rivals: 1, budgetLeft: 4 }).bid, 4);

// Manager styles are relative to the league's other managers.
const bids = (ownerId, list) => list.map((bid) => ({ season: 2025, week: 3, ownerId, playerId: "p", bid, won: false, competing: true }));
const styles = managerStyles([
  ...bids("big", [5, 10, 20, 40, 60]),
  ...bids("mid", [2, 4, 6, 10, 15]),
  ...bids("mid2", [3, 5, 8, 12, 14]),
  ...bids("low", [0, 1, 1, 2, 3]),
]);
assert.equal(styles.get("big").label, "aggressive");
assert.equal(styles.get("low").label, "conservative");
assert.equal(styles.get("mid").label, "typical");

console.log("faab tests passed");
