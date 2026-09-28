import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SleeperLeague = {
  league_id: string;
  name: string;
  total_rosters: number;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  settings?: { waiver_budget?: number };
};
export type SleeperRoster = {
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  roster_id: number;
  settings?: { waiver_budget_used?: number };
};
type LeagueState = {
  username: string;
  userId: string;
  leagues: SleeperLeague[];
  selected: SleeperLeague | null;
  rosters: SleeperRoster[];
  loading: boolean;
  error: string;
  connect: (username: string) => Promise<void>;
  select: (leagueId: string) => void;
  disconnect: () => void;
};
const Context = createContext<LeagueState | null>(null);
const USER_KEY = "opportunity-sleeper-username";
const LEAGUE_KEY = "opportunity-sleeper-league";

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [rosters, setRosters] = useState<SleeperRoster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function connect(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `https://api.sleeper.app/v1/user/${encodeURIComponent(trimmed)}`,
      );
      if (!response.ok) throw new Error("Sleeper could not find that username.");
      const user = (await response.json()) as { user_id?: string };
      if (!user.user_id) throw new Error("Sleeper could not find that username.");
      const leaguesResponse = await fetch(
        `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/2026`,
      );
      if (!leaguesResponse.ok) throw new Error("Sleeper leagues are unavailable right now.");
      const found = (await leaguesResponse.json()) as SleeperLeague[];
      if (!found.length)
        throw new Error("No 2026 Sleeper NFL leagues were found for this username.");
      const savedId = typeof localStorage !== "undefined" ? localStorage.getItem(LEAGUE_KEY) : null;
      const nextId = found.some((l) => l.league_id === savedId) ? savedId! : found[0]!.league_id;
      setUsername(trimmed);
      setUserId(user.user_id);
      setLeagues(found);
      setSelectedId(nextId);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(USER_KEY, trimmed);
        localStorage.setItem(LEAGUE_KEY, nextId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sleeper is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem(USER_KEY);
    if (saved) void connect(saved);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setRosters([]);
    fetch(`https://api.sleeper.app/v1/league/${selectedId}/rosters`)
      .then((response) => {
        if (!response.ok) throw new Error("Sleeper rosters are unavailable right now.");
        return response.json() as Promise<SleeperRoster[]>;
      })
      .then((found) => {
        if (!cancelled) setRosters(found);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Roster lookup failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function select(leagueId: string) {
    setSelectedId(leagueId);
    setError("");
    localStorage.setItem(LEAGUE_KEY, leagueId);
  }
  function disconnect() {
    setUsername("");
    setUserId("");
    setLeagues([]);
    setSelectedId("");
    setRosters([]);
    setError("");
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LEAGUE_KEY);
  }
  return (
    <Context.Provider
      value={{
        username,
        userId,
        leagues,
        selected: leagues.find((l) => l.league_id === selectedId) ?? null,
        rosters,
        loading,
        error,
        connect,
        select,
        disconnect,
      }}
    >
      {children}
    </Context.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Hook shares this provider's context.
export function useLeague() {
  const value = useContext(Context);
  if (!value) throw new Error("LeagueProvider is missing");
  return value;
}

// Top-bar switcher: one connection drives every page.
export function LeagueSwitcher() {
  const league = useLeague();
  if (league.loading && !league.selected)
    return <span className="text-xs text-muted-foreground">Connecting to Sleeper…</span>;
  if (!league.selected) return null;
  return (
    <div className="flex items-center gap-2">
      <select
        value={league.selected.league_id}
        onChange={(e) => league.select(e.target.value)}
        aria-label="Active league"
        className="h-9 max-w-[180px] rounded-md border border-input bg-background px-2 text-sm font-semibold md:max-w-[260px]"
      >
        {league.leagues.map((l) => (
          <option key={l.league_id} value={l.league_id}>
            {l.name}
          </option>
        ))}
      </select>
      <span className="hidden text-xs text-muted-foreground xl:inline">
        {league.selected.total_rosters} teams ·{" "}
        {league.selected.scoring_settings["rec"] === 0.5 ? "Half" : "Full"} PPR · {league.username}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="hidden md:inline-flex"
        onClick={league.disconnect}
      >
        Disconnect
      </Button>
    </div>
  );
}

// Shown at the top of every page until a league is connected.
export function ConnectBanner() {
  const league = useLeague();
  const [name, setName] = useState("");
  if (league.selected || (league.loading && !name)) return null;
  function submit(event: FormEvent) {
    event.preventDefault();
    void league.connect(name);
  }
  return (
    <section className="mb-6 rounded-lg border-2 border-volt bg-card p-5">
      <h2 className="font-display text-xl font-semibold">Connect your Sleeper league</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Rankings, trades and waivers then use your league's scoring, lineup and your roster. Or keep
        browsing general rankings below.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-3">
        <Input
          className="w-56"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sleeper username"
          aria-label="Sleeper username"
        />
        <Button type="submit" disabled={!name.trim() || league.loading}>
          {league.loading ? "Connecting…" : "Connect"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Read-only. We look up your public Sleeper leagues; your username is saved only in this
          browser.
        </span>
      </form>
      {league.error && (
        <p role="alert" className="mt-3 text-sm text-warning">
          {league.error}
        </p>
      )}
    </section>
  );
}
