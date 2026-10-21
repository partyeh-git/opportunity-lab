import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLeague } from "@/components/league-context";
import { fetchPublicJson } from "@/lib/live-data";

type Risk = "Low" | "Medium" | "High";
type Package = {
  get: string[];
  getValue: number;
  getMarket: number | null;
  getRisk: Risk | null;
  net: number;
  marketAgrees: boolean;
  note: string;
};
type Buyer = { owner: string; rosterId: number; fit: string; packages: Package[] };
type SellIdea = {
  asset: string;
  assetId: string;
  pos: string;
  ourValue: number;
  marketValue: number | null;
  risk: Risk | null;
  bustPct: number | null;
  verdict: string;
  note: string;
  buyers: Buyer[];
  /** Rank among all players and picks: by our Rebuild value, and by market (KeepTradeCut). */
  ourRank?: number | null;
  marketRank?: number | null;
};
type BuyLow = {
  player: string;
  id: string;
  pos: string;
  age: number | null;
  owner: string;
  ourValue: number;
  marketValue: number | null;
  risk: Risk | null;
  bustPct: number | null;
  why: string;
  offerIdea: string;
  ourRank?: number | null;
  marketRank?: number | null;
};
type Team = {
  rosterId: number;
  owner: string;
  record: string;
  status: string;
  playoffOdds: number;
  qb: string;
  needs: string[];
  picks: string[];
};
type TradeIdeasFile = {
  leagueId: string;
  generatedAt: string;
  myRosterId: number;
  plan: string;
  teams: Team[];
  sell: SellIdea[];
  buyLow: BuyLow[];
  concepts: string[];
};

const STATUSES = ["", "Pursuing", "Passed", "Done"] as const;
const statusKey = (leagueId: string) => `trade-idea-status-v1:${leagueId}`;
const riskChip: Record<string, string> = {
  Low: "bg-lime-100 text-lime-800 dark:bg-lime-400/20 dark:text-lime-200",
  Medium: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200",
  High: "bg-red-100 text-red-800 dark:bg-red-400/20 dark:text-red-200",
};

function RiskChip({ risk, bust }: { risk: Risk | null; bust?: number | null }) {
  if (!risk) return null;
  return (
    <span
      className={`inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-bold ${riskChip[risk]}`}
    >
      {risk} risk{bust != null && <span className="ml-1 font-normal opacity-80">bust {bust}%</span>}
    </span>
  );
}

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${Math.round(n)}`;
}

/** Trade ideas for a dynasty league: who to sell, to whom, for what, plus buy-low targets. */
export function TradeIdeas() {
  const league = useLeague();
  const leagueId = league.selected?.league_id ?? "";
  const ideas = useQuery({
    queryKey: ["trade-ideas"],
    queryFn: () => fetchPublicJson<TradeIdeasFile>("trade-ideas.json"),
    staleTime: Infinity,
  });
  const [status, setStatus] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const raw = leagueId ? localStorage.getItem(statusKey(leagueId)) : null;
      setStatus(raw ? (JSON.parse(raw) as Record<string, string>) : {});
    } catch {
      setStatus({});
    }
  }, [leagueId]);
  function mark(key: string, value: string) {
    const next = { ...status, [key]: value };
    if (!value) delete next[key];
    setStatus(next);
    try {
      localStorage.setItem(statusKey(leagueId), JSON.stringify(next));
    } catch {
      // Not saved; fine for this visit.
    }
  }

  const file = ideas.data;
  if (ideas.isLoading) return <p className="text-sm text-muted-foreground">Loading trade ideas…</p>;
  if (!file || (leagueId && leagueId !== file.leagueId))
    return (
      <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        No trade ideas for this league yet.
      </p>
    );

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <p className="broadcast-tag text-xs uppercase">
          Trade ideas · {file.plan} plan · updated {new Date(file.generatedAt).toLocaleDateString()}
        </p>
        <ul className="max-w-3xl list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          {file.concepts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Sell candidates</h2>
        {file.sell.map((s) => (
          <div key={s.assetId} className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-display text-lg font-semibold">{s.asset}</h3>
              <span className="text-xs text-muted-foreground">{s.pos}</span>
              <span className="text-sm">
                Our value <strong>{Math.round(s.ourValue)}</strong>
                {s.ourRank != null && (
                  <span className="text-muted-foreground">
                    {" "}
                    · rank #{s.ourRank} ours
                    {s.marketRank != null && `, #${s.marketRank} market`}
                  </span>
                )}
              </span>
              <RiskChip risk={s.risk} bust={s.bustPct} />
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">
                {s.verdict}
              </span>
            </div>
            {s.note && <p className="text-sm text-muted-foreground">{s.note}</p>}
            {s.buyers.map((b) => (
              <div key={b.owner} className="space-y-2 border-t pt-3">
                <p className="text-sm">
                  <strong>{b.owner}</strong>
                  <span className="text-muted-foreground"> · {b.fit}</span>
                </p>
                {b.packages.map((p) => {
                  const key = `${s.assetId}|${b.rosterId}|${p.get.join("+")}`;
                  return (
                    <div
                      key={key}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 text-sm ${status[key] === "Passed" ? "opacity-50" : "bg-muted/40"}`}
                    >
                      <span className="font-medium">Get: {p.get.join(" + ")}</span>
                      <span className="tabular-nums">
                        value {Math.round(p.getValue)}{" "}
                        <strong
                          className={
                            p.net >= 0 ? "text-lime-700 dark:text-lime-300" : "text-red-600"
                          }
                        >
                          ({signed(p.net)})
                        </strong>
                      </span>
                      <RiskChip risk={p.getRisk} />
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[11px] font-bold ${p.marketAgrees ? "bg-sky-100 text-sky-800 dark:bg-sky-400/20 dark:text-sky-200" : "bg-slate-200 text-slate-700 dark:bg-slate-400/20 dark:text-slate-200"}`}
                      >
                        {p.marketAgrees ? "Market agrees" : "Our model only"}
                      </span>
                      {p.note && <span className="text-xs text-muted-foreground">{p.note}</span>}
                      <select
                        value={status[key] ?? ""}
                        onChange={(e) => mark(key, e.target.value)}
                        aria-label="Idea status"
                        className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {STATUSES.map((v) => (
                          <option key={v} value={v}>
                            {v || "Status"}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold">Buy-low targets</h2>
        <div className="overflow-auto rounded-lg border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-broadcast text-left text-xs font-semibold uppercase tracking-wide text-broadcast-foreground">
              <tr>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2 text-right">Our value</th>
                <th className="px-3 py-2 text-right">Rank: ours / market</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Why / offer idea</th>
              </tr>
            </thead>
            <tbody>
              {file.buyLow.map((b) => (
                <tr key={b.id} className="border-t align-top">
                  <td className="px-3 py-2 font-semibold">
                    {b.player}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {b.pos}
                      {b.age ? ` · age ${Math.floor(b.age)}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{b.owner}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Math.round(b.ourValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {b.ourRank != null ? `#${b.ourRank}` : "–"} /{" "}
                    {b.marketRank != null ? `#${b.marketRank}` : "–"}
                  </td>
                  <td className="px-3 py-2">
                    <RiskChip risk={b.risk} bust={b.bustPct} />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <p>{b.why}</p>
                    <p className="text-muted-foreground">{b.offerIdea}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold">League needs</h2>
        <div className="overflow-auto rounded-lg border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-broadcast text-left text-xs font-semibold uppercase tracking-wide text-broadcast-foreground">
              <tr>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">QB situation</th>
                <th className="px-3 py-2">Needs</th>
                <th className="px-3 py-2">Picks held</th>
              </tr>
            </thead>
            <tbody>
              {file.teams.map((t) => (
                <tr
                  key={t.rosterId}
                  className={`border-t align-top ${t.rosterId === file.myRosterId ? "bg-volt/10" : ""}`}
                >
                  <td className="px-3 py-2 font-semibold">
                    {t.owner}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {t.record}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {t.status}
                    <span className="text-muted-foreground"> · playoffs {t.playoffOdds}%</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{t.qb}</td>
                  <td className="px-3 py-2 text-xs">{t.needs.join(", ") || "–"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{t.picks.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
