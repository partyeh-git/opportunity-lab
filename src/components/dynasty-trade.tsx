import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLeague } from "@/components/league-context";
import { fetchPublicJson } from "@/lib/live-data";

type Plan = "win_now" | "balanced" | "rebuild";
type Asset = {
  id: string;
  name: string;
  pos: string;
  team: string | null;
  age: number | null;
  pickOwner: string | null;
  slot?: string | null;
  totals: Record<Plan, number>;
  bust?: number | null;
  mkt?: number | null;
};
type ValuesFile = { leagueId: string; players: Asset[] };

const PLANS: [Plan, string][] = [
  ["win_now", "Win now"],
  ["balanced", "Balanced"],
  ["rebuild", "Rebuild"],
];

function sum(list: Asset[], plan: Plan) {
  return list.reduce((t, a) => t + a.totals[plan], 0);
}
/** Value-weighted bust chance of a package (picks and players). */
function packageBust(list: Asset[], plan: Plan) {
  const total = sum(list, plan);
  if (!total) return null;
  return Math.round(list.reduce((t, a) => t + (a.bust ?? 0) * a.totals[plan], 0) / total);
}

function Side({
  title,
  assets,
  onRemove,
  onAdd,
  options,
  plan,
  ownerOf,
}: {
  title: string;
  assets: Asset[];
  onRemove: (id: string) => void;
  onAdd: (a: Asset) => void;
  options: Asset[];
  plan: Plan;
  ownerOf: (a: Asset) => string;
}) {
  const [q, setQ] = useState("");
  // Every word must match the name or the owner, so "zig 2028" finds ZigZag's 2028 picks.
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length
    ? options
        .filter((a) => {
          const text = `${a.name} ${ownerOf(a)}`.toLowerCase();
          return words.every((w) => text.includes(w));
        })
        .filter((a) => !assets.some((x) => x.id === a.id))
        .slice(0, 12)
    : [];
  const bust = packageBust(assets, plan);
  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <span className="font-display text-2xl tabular-nums">{Math.round(sum(assets, plan))}</span>
      </div>
      <div className="relative">
        <Input
          placeholder="Add a player or pick (e.g. zig 2027 round 1)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={`Add to ${title}`}
        />
        {matches.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
            {matches.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onAdd(a);
                    setQ("");
                  }}
                >
                  <span>
                    {a.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {a.pos}
                      {ownerOf(a) ? ` · ${ownerOf(a)}` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {Math.round(a.totals[plan])}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ul className="space-y-1">
        {assets.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 text-sm"
          >
            <span>
              {a.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {[
                  a.pos,
                  a.slot ? `projected ${a.slot.toLowerCase()}` : "",
                  a.bust != null ? `bust ${a.bust}%` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{Math.round(a.totals[plan])}</span>
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)}>
                <X className="h-4 w-4 opacity-60 hover:opacity-100" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {bust != null && assets.length > 0 && (
        <p className="text-xs text-muted-foreground">Package bust chance about {bust}%</p>
      )}
    </div>
  );
}

/** Build a trade from players and picks and see it in our values, the market and risk. */
export function DynastyTradeCalculator() {
  const league = useLeague();
  const leagueId = league.selected?.league_id ?? "";
  const values = useQuery({
    queryKey: ["dynasty-values"],
    queryFn: () => fetchPublicJson<ValuesFile>("dynasty-values.json"),
    staleTime: Infinity,
  });
  const users = useQuery({
    queryKey: ["league-users", leagueId],
    enabled: Boolean(leagueId),
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
      return response.ok
        ? ((await response.json()) as { user_id: string; display_name: string }[])
        : [];
    },
  });
  // Your side only: the calculator uses the team plan you chose on the Board (default Rebuild).
  const [plan, setPlan] = useState<Plan>("rebuild");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("dynasty-plan-v1") as Plan | null;
      if (stored && PLANS.some(([p]) => p === stored)) setPlan(stored);
    } catch {
      // Storage blocked: stay on Rebuild.
    }
  }, []);
  const [give, setGive] = useState<Asset[]>([]);
  const [get, setGet] = useState<Asset[]>([]);

  const owners = useMemo(() => {
    const names = new Map((users.data ?? []).map((u) => [u.user_id, u.display_name]));
    const map = new Map<string, string>();
    for (const r of league.rosters)
      for (const id of [...(r.players ?? []), ...(r.reserve ?? [])])
        map.set(id, names.get(r.owner_id) ?? `Team ${r.roster_id}`);
    return map;
  }, [league.rosters, users.data]);
  const ownerOf = (a: Asset) => a.pickOwner ?? owners.get(a.id) ?? "";

  const file = values.data;
  if (!file) return <p className="text-sm text-muted-foreground">Loading values…</p>;
  const options = file.players;

  const giveTotal = sum(give, plan);
  const getTotal = sum(get, plan);
  const net = getTotal - giveTotal;
  const bigger = Math.max(giveTotal, getTotal);
  const close = bigger > 0 && Math.abs(net) <= bigger * 0.1;
  const ours =
    !give.length || !get.length
      ? null
      : close
        ? "About even on our values."
        : net > 0
          ? `You win by ${Math.round(net)} on our values.`
          : `You lose ${Math.round(-net)} on our values.`;

  const marketKnown = [...give, ...get].every((a) => a.mkt != null);
  const mktGive = give.reduce((t, a) => t + (a.mkt ?? 0), 0);
  const mktGet = get.reduce((t, a) => t + (a.mkt ?? 0), 0);
  const ratio = mktGive ? mktGet / mktGive : 0;
  const market =
    !give.length || !get.length
      ? null
      : !marketKnown
        ? "Market price missing for at least one piece."
        : ratio <= 1
          ? "By KeepTradeCut prices: fair to them or in their favor. A real manager could say yes."
          : ratio <= 1.35
            ? "By KeepTradeCut prices: tilted your way. Possible, especially if they need the piece."
            : "By KeepTradeCut prices: well above market for you. Only likely if they badly need the piece (this league has paid QB premiums).";
  const spots = get.length - give.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          Your plan: <strong>{PLANS.find(([p]) => p === plan)?.[1]}</strong>
          <span className="text-muted-foreground"> (change it on the Board)</span>
        </span>
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => {
            setGive([]);
            setGet([]);
          }}
        >
          Clear
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Side
          title="You give"
          assets={give}
          onAdd={(a) => setGive([...give, a])}
          onRemove={(id) => setGive(give.filter((a) => a.id !== id))}
          options={options}
          plan={plan}
          ownerOf={ownerOf}
        />
        <Side
          title="You get"
          assets={get}
          onAdd={(a) => setGet([...get, a])}
          onRemove={(id) => setGet(get.filter((a) => a.id !== id))}
          options={options}
          plan={plan}
          ownerOf={ownerOf}
        />
      </div>
      {ours && (
        <section className="space-y-1 rounded-lg border bg-card p-4 text-sm">
          <p className="font-semibold">{ours}</p>
          {market && <p>{market}</p>}
          {spots > 0 && (
            <p className="text-muted-foreground">
              You take back {spots} more piece{spots > 1 ? "s" : ""} than you send, so you need{" "}
              {spots} open roster spot{spots > 1 ? "s" : ""} (or a drop).
            </p>
          )}
          {spots < 0 && (
            <p className="text-muted-foreground">
              You consolidate: one stronger piece usually beats several weaker ones, and you free{" "}
              {-spots} roster spot{spots < -1 ? "s" : ""}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Values use the {PLANS.find(([p]) => p === plan)?.[1]} plan. Next year's picks are valued
            at their projected slot from current standings.
          </p>
        </section>
      )}
    </div>
  );
}
