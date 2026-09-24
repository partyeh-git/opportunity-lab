/**
 * FAAB helpers: a league's own bid history (read from Sleeper's public API in the browser),
 * manager bidding styles, price ranges, and a suggested bid. Nothing here submits a claim, and
 * no league or bid data is stored outside the viewer's browser.
 *
 * Research behind the rules (2018-2026 auctions, fit 2018-2023, checked on 2024):
 * - The number of bidders sets the price; box-score stats barely predict it.
 * - When a regular at the player's position on his own team is hurt for the upcoming week,
 *   the winning price runs about 1.6x and about 40% more teams bid.
 * - Winning bids are typically ~4x the second-highest bid, so over-bidding is common.
 */

export type Claim = {
  season: number;
  /** Sleeper labels a waiver run with the week just played. */
  week: number;
  ownerId: string | null;
  playerId: string;
  bid: number;
  won: boolean;
  /** Won, or lost to a higher bid (not failed for roster room or budget). */
  competing: boolean;
};

export type Market = {
  n: number;
  median: number;
  p70: number;
  p75: number;
  p90: number;
  max: number;
};

export type ManagerStyle = {
  ownerId: string;
  claims: number;
  p90: number;
  max: number;
  bigBids: number;
  label: "aggressive" | "typical" | "conservative";
};

/** Starter-hurt price multiplier learned from league history (see header). */
export const INJURY_NEWS_MULTIPLIER = 1.6;
/** Weeks 1-4 carry the season's hottest markets. */
export const EARLY_WEEKS = 4;
/** Worth to you: share of remaining budget = rest-of-season lineup gain / this many points. */
export const POINTS_FOR_FULL_BUDGET = 100;
/** Never suggest spending more than this share of what's left on one player. */
export const MAX_BUDGET_SHARE = 0.6;

export function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function summarize(bids: number[]): Market {
  return {
    n: bids.length,
    median: quantile(bids, 0.5),
    p70: quantile(bids, 0.7),
    p75: quantile(bids, 0.75),
    p90: quantile(bids, 0.9),
    max: bids.length ? Math.max(...bids) : 0,
  };
}

/** Winning bids for a position in the same part of the season; falls back to all weeks. */
export function marketFor(
  claims: Claim[],
  positions: Record<string, string>,
  position: string,
  early: boolean,
  minimum = 8,
): Market | null {
  const wins = claims.filter((c) => c.won && positions[c.playerId] === position);
  const sameStretch = wins.filter((c) => c.week <= EARLY_WEEKS === early).map((c) => c.bid);
  if (sameStretch.length >= minimum) return summarize(sameStretch);
  return wins.length ? summarize(wins.map((c) => c.bid)) : null;
}

/** Each manager's bidding habits, labeled against the league's other managers. */
export function managerStyles(claims: Claim[]): Map<string, ManagerStyle> {
  const byOwner = new Map<string, number[]>();
  for (const c of claims) {
    if (!c.competing || !c.ownerId) continue;
    byOwner.set(c.ownerId, [...(byOwner.get(c.ownerId) ?? []), c.bid]);
  }
  const p90s = [...byOwner.values()].filter((b) => b.length >= 5).map((b) => quantile(b, 0.9));
  const leagueP90 = quantile(p90s, 0.5);
  return new Map(
    [...byOwner].map(([ownerId, bids]) => {
      const p90 = quantile(bids, 0.9);
      const label: ManagerStyle["label"] =
        bids.length < 5 || !leagueP90
          ? "typical"
          : p90 >= 1.3 * leagueP90
            ? "aggressive"
            : p90 <= 0.75 * leagueP90
              ? "conservative"
              : "typical";
      return [
        ownerId,
        {
          ownerId,
          claims: bids.length,
          p90,
          max: Math.max(...bids),
          bigBids: bids.filter((b) => b >= 25).length,
          label,
        },
      ];
    }),
  );
}

/** What the player is worth to you in dollars, from his rest-of-season lineup gain. */
export function worthDollars(rosGain: number, budgetLeft: number) {
  const share = Math.min(MAX_BUDGET_SHARE, Math.max(0, rosGain) / POINTS_FOR_FULL_BUDGET);
  return Math.round(budgetLeft * share);
}

export type BidAdvice = { bid: number; priceToWin: number; note: string };

/**
 * Suggested bid = the lower of his worth to you and the price that has won about 70% of
 * comparable auctions in this league (x1.6 when the starter ahead of him is hurt).
 */
export function suggestBid({
  worth,
  market,
  starterHurt,
  rivals,
  budgetLeft,
}: {
  worth: number;
  market: Market | null;
  starterHurt: boolean;
  rivals: number;
  budgetLeft: number;
}): BidAdvice {
  if (worth <= 0) return { bid: 0, priceToWin: 0, note: "Doesn't improve your lineup." };
  if (rivals === 0) {
    const bid = Math.min(worth, budgetLeft, 1);
    return {
      bid,
      priceToWin: 1,
      note: "No other team clearly needs him; likely little competition.",
    };
  }
  const base = market ? market.p70 : 5;
  const priceToWin = Math.max(1, Math.round(base * (starterHurt ? INJURY_NEWS_MULTIPLIER : 1)));
  const bid = Math.min(worth, priceToWin, budgetLeft);
  const note =
    priceToWin > worth
      ? `The market likely goes above his value to you (~$${priceToWin} to win).`
      : starterHurt
        ? "Starter ahead of him is hurt; expect a bidding war."
        : "Bid sized to win about 70% of similar auctions here.";
  return { bid, priceToWin, note };
}

type SleeperTransaction = {
  type: string;
  status: string;
  leg: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  settings?: { waiver_bid?: number } | null;
  metadata?: { notes?: string } | null;
};

/** Read up to `seasonsBack` prior seasons of this league's waiver claims from Sleeper. */
export async function fetchLeagueClaims(leagueId: string, seasonsBack = 8): Promise<Claim[]> {
  const claims: Claim[] = [];
  let id: string | null = leagueId;
  for (let i = 0; id && i <= seasonsBack; i++) {
    const [meta, rosters] = (await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${id}`).then((r) => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${id}/rosters`).then((r) => r.json()),
    ])) as [
      { season: string; previous_league_id?: string | null },
      { roster_id: number; owner_id: string | null }[],
    ];
    const owners = new Map(rosters.map((r) => [r.roster_id, r.owner_id]));
    const weeks = await Promise.all(
      Array.from({ length: 18 }, (_, w) =>
        fetch(`https://api.sleeper.app/v1/league/${id}/transactions/${w + 1}`)
          .then((r) => (r.ok ? (r.json() as Promise<SleeperTransaction[] | null>) : []))
          .catch(() => []),
      ),
    );
    for (const t of weeks.flatMap((w) => w ?? [])) {
      const bid = t.settings?.waiver_bid;
      if (t.type !== "waiver" || !t.adds || typeof bid !== "number") continue;
      const won = t.status === "complete";
      const outbid = /claimed by another/i.test(t.metadata?.notes ?? "");
      for (const playerId of Object.keys(t.adds))
        claims.push({
          season: Number(meta.season),
          week: t.leg,
          ownerId: owners.get(t.roster_ids?.[0] ?? -1) ?? null,
          playerId,
          bid,
          won,
          competing: won || outbid,
        });
    }
    id =
      meta.previous_league_id && meta.previous_league_id !== "0" ? meta.previous_league_id : null;
  }
  return claims;
}
