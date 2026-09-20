import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Player = {
  player_id: string;
  full_name?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
  position?: string | undefined;
  team?: string | null | undefined;
  active?: boolean | undefined;
  status?: string | null | undefined;
  injury_status?: string | null | undefined;
  injury_body_part?: string | null | undefined;
  injury_notes?: string | null | undefined;
  age?: number | undefined;
  years_exp?: number | undefined;
};
const positions = ["QB", "RB", "WR", "TE", "K", "DEF"];
const nameOf = (p: Player) =>
  p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.player_id;
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function loadPlayers(): Promise<{ players: Player[]; fetchedAt: string }> {
  // Persist the large directory for a day, as requested by Sleeper's API guidance.
  const key = "opportunity-player-directory-v1";
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    if (
      cached &&
      Array.isArray(cached.players) &&
      Date.now() - Date.parse(cached.fetchedAt) < 86400000
    )
      return cached;
  } catch {
    /* Storage may be unavailable. */
  }
  const response = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!response.ok) throw new Error("Player data could not be loaded. Please try again.");
  const raw = (await response.json()) as Record<string, Player>;
  const players = Object.entries(raw)
    .filter(([, p]) => positions.includes(p.position || ""))
    .map(([id, p]) => ({
      player_id: id,
      full_name: nameOf(p),
      position: p.position,
      team: p.team,
      active: p.active,
      status: p.status,
      injury_status: p.injury_status,
      injury_body_part: p.injury_body_part,
      injury_notes: p.injury_notes,
      age: p.age,
      years_exp: p.years_exp,
    }));
  const result = { players, fetchedAt: new Date().toISOString() };
  try {
    localStorage.setItem(key, JSON.stringify(result));
  } catch {
    /* In-memory cache remains available. */
  }
  return result;
}

export function PlayerResearch() {
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("All");
  const [team, setTeam] = useState("All");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<Player | null>(null);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["sleeper-player-directory"],
    queryFn: loadPlayers,
    staleTime: 86400000,
    gcTime: 86400000,
    retry: 1,
  });
  const teams = useMemo(
    () => [...new Set(data?.players.map((p) => p.team).filter((t): t is string => !!t))].sort(),
    [data],
  );
  const filtered = useMemo(
    () =>
      (data?.players || [])
        .filter(
          (p) =>
            (includeInactive || (p.active !== false && p.status !== "Inactive" && !!p.team)) &&
            (position === "All" || p.position === position) &&
            (team === "All" || p.team === team) &&
            normalized(nameOf(p)).includes(normalized(search)),
        )
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [data, search, position, team, includeInactive],
  );
  return (
    <div className="space-y-6">
      <section className="border-b pb-7">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">
          Your player research hub
        </p>
        <h2 className="mt-3 font-display text-4xl font-semibold">
          Find the player. Know your options.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Search NFL players, check team and position, and inspect reported status before making
          your next roster decision.
        </p>
      </section>
      <section className="rounded-lg border bg-card p-4 md:p-6" aria-label="Player search filters">
        <div className="grid gap-4 md:grid-cols-[1fr_130px_150px]">
          <label className="text-sm font-medium">
            Player name
            <div className="relative mt-2">
              <Search
                className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                className="pl-9"
                placeholder="Search Amon-Ra, Maye, Loveland…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(50);
                }}
              />
            </div>
          </label>
          <label className="text-sm font-medium">
            Position
            <select
              className="mt-2 h-9 w-full rounded-md border bg-background px-3"
              value={position}
              onChange={(e) => {
                setPosition(e.target.value);
                setLimit(50);
              }}
            >
              {["All", ...positions].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            NFL team
            <select
              className="mt-2 h-9 w-full rounded-md border bg-background px-3"
              value={team}
              onChange={(e) => {
                setTeam(e.target.value);
                setLimit(50);
              }}
            >
              <option>All</option>
              {teams.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => {
              setIncludeInactive(e.target.checked);
              setLimit(50);
            }}
          />
          Include inactive players and NFL free agents
        </label>
      </section>
      {isPending && (
        <p role="status" className="py-12 text-center text-muted-foreground">
          Loading the player directory…
        </p>
      )}
      {isError && (
        <div role="alert" className="rounded-lg border p-6">
          <p>Unable to load Sleeper player data.</p>
          <Button className="mt-3" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}
      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p role="status">
              {filtered.length.toLocaleString()} players · Alphabetical order, not fantasy rank
            </p>
            <p>Directory retrieved {new Date(data.fetchedAt).toLocaleString()}</p>
          </div>
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="grid grid-cols-[1fr_100px_24px] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-semibold uppercase text-muted-foreground sm:grid-cols-[1fr_90px_160px_24px]">
              <span>Player</span>
              <span className="hidden sm:block">Team</span>
              <span>Sleeper status</span>
              <span />
            </div>
            {filtered.slice(0, limit).map((p) => (
              <button
                key={p.player_id}
                onClick={() => setSelected(p)}
                className="grid w-full grid-cols-[1fr_100px_24px] items-center gap-3 border-b px-4 py-4 text-left last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-primary sm:grid-cols-[1fr_90px_160px_24px]"
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{nameOf(p)}</strong>
                  <span className="text-xs text-muted-foreground">
                    {p.position}
                    <span className="sm:hidden"> · {p.team || "No team"}</span>
                  </span>
                </span>
                <span className="hidden text-sm sm:block">{p.team || "No team"}</span>
                <span
                  className={`text-xs ${p.injury_status ? "text-warning" : "text-muted-foreground"}`}
                >
                  {p.injury_status || p.status || "Not reported"}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
            {!filtered.length && (
              <div className="p-10 text-center">
                <p>No players match your filters.</p>
                <Button
                  variant="link"
                  onClick={() => {
                    setSearch("");
                    setTeam("All");
                    setPosition("All");
                    setIncludeInactive(false);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
          {filtered.length > limit && (
            <Button variant="outline" onClick={() => setLimit((n) => n + 50)}>
              Show more players
            </Button>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Source:{" "}
            <a
              className="underline"
              href="https://docs.sleeper.com/#players"
              target="_blank"
              rel="noreferrer"
            >
              Sleeper player directory
            </a>
            , cached for up to 24 hours. Retrieval time is not the time of an injury report.
            “Active” does not confirm game-day availability. NFL free agency is separate from
            availability in your fantasy league.
          </p>
        </>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {selected && nameOf(selected)}
            </DialogTitle>
            <DialogDescription>
              {selected?.position} · {selected?.team || "No NFL team listed"}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-5">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ["Roster status", selected.status || "Not reported"],
                  ["Injury designation", selected.injury_status || "No designation reported"],
                  ["Reported injury", selected.injury_body_part || "Not reported"],
                  [
                    "NFL experience",
                    selected.years_exp == null ? "Not reported" : `${selected.years_exp} years`,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              {selected.injury_notes && (
                <p className="rounded-md bg-muted p-3 text-sm">{selected.injury_notes}</p>
              )}
              <p className="text-xs leading-5 text-muted-foreground">
                Sleeper directory status may lag current reports and does not confirm whether this
                player will play. Retrieved {data && new Date(data.fetchedAt).toLocaleString()}.
              </p>
              <div className="rounded-md border p-4">
                <h3 className="text-sm font-semibold">Projections & start/sit</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Points, outcome ranges, and recommendations are not available for this player yet.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Fantasy roster ownership has not been checked.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
