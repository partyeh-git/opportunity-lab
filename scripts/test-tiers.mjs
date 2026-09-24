import assert from "node:assert/strict";
import { boardTiers, tierValues } from "../src/lib/tiers.ts";

// Obvious clusters split at the obvious gaps, whatever the input order.
const clusters = [30, 10, 29.5, 20, 9.8, 19.6, 30.2, 10.1];
assert.deepEqual(tierValues(clusters, 0.97), [1, 3, 1, 2, 3, 2, 1, 3]);

// A forced tier count still breaks at the biggest gaps.
assert.deepEqual(tierValues([10, 9, 5, 4, 1], 1, 2, 2), [1, 1, 2, 2, 2]);

// Players below the tiered depth share one final "deep" tier.
const board = boardTiers([50, 49, 30, 29, 10, 9, 1, 0.5], 6, 2);
assert.deepEqual(board, [1, 1, 2, 2, 3, 3, 4, 4]);

// Identical values stay together and empty boards are safe.
assert.deepEqual(tierValues([5, 5, 5]), [1, 1, 1]);
assert.deepEqual(boardTiers([], 10, 5), []);
console.log("Tier checks passed.");
