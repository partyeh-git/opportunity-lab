import assert from "node:assert/strict";
import {
  chanceReason,
  chanceToPlay,
  gameStatus,
  gamesJustMissed,
} from "../src/lib/availability.ts";

// Designations map to the four statuses; IR and suspensions count as out.
assert.equal(gameStatus("Questionable"), "Questionable");
assert.equal(gameStatus("IR"), "Out");
assert.equal(gameStatus("Sus"), "Out");
assert.equal(gameStatus(null), "None");

// Chances follow the learned order: healthy > questionable > doubtful > out.
const healthy = chanceToPlay("None", 0);
const q = chanceToPlay("Questionable", 0);
const d = chanceToPlay("Doubtful", 0);
const out = chanceToPlay("Out", 0);
assert.ok(healthy > 0.95 && healthy > q && q > d && d > out && out < 0.1);
// Healthy (no designation) players are never penalized for games they just missed.
assert.equal(chanceToPlay("None", 1), healthy);
assert.equal(chanceToPlay("None", 2), healthy);
assert.equal(chanceReason("None", 1), "no injury designation");
// Designated players still carry the missed-game history.
assert.ok(chanceToPlay("Questionable", 1) !== undefined);
// Unseen combinations fall back to a broader rate instead of failing.
assert.ok(chanceToPlay("Doubtful", 2, "Full") > 0 && chanceToPlay("Doubtful", 2, "Full") < 1);

// Byes are not missed games: SEA played Weeks 1 and 2 in 2026.
assert.equal(gamesJustMissed("SEA", 2, 3), 0);
assert.equal(gamesJustMissed("SEA", 1, 3), 1);
assert.equal(gamesJustMissed("SEA", 0, 3), 2);
assert.equal(chanceReason("Questionable", 1), "Questionable · missed last game");
// Practice level moves a questionable player: full practice > limited > did not practice.
const [full, limited, dnp] = ["Full", "Limited", "DNP"].map((p) => chanceToPlay("Questionable", 0, p));
assert.ok(full > limited && limited > dnp && full > 0.85 && dnp < 0.6);
// Ruled out and doubtful players almost never play, whatever the practice level.
assert.ok(chanceToPlay("Out", 0, "Limited") < 0.01 && chanceToPlay("Doubtful", 0, "Limited") < 0.05);
assert.equal(chanceReason("Questionable", 0, "Limited"), "Questionable · limited practice");
console.log("Availability checks passed.");
