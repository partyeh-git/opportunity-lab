import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  ArrowRightLeft,
  BarChart3,
  ChevronRight,
  Gauge,
  Menu,
  Newspaper,
  Search,
  ShieldCheck,
  Trophy,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trades } from "@/components/rankings-trades";
import { PersonalRankings } from "@/components/personal-rankings";
import { WaiversFaab } from "@/components/waivers-faab";
import { LeagueProvider } from "@/components/league-context";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fantasy HQ" },
      {
        name: "description",
        content: "An honest, explainable fantasy-football analytics research workspace.",
      },
      { property: "og:title", content: "Fantasy HQ" },
      {
        property: "og:description",
        content: "An honest, explainable fantasy-football analytics research workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <LeagueProvider>
      <Index />
    </LeagueProvider>
  ),
});

const navItems = [
  ["Overall Rankings", BarChart3],
  ["Start / Sit", ArrowRightLeft],
  ["Weekly Rankings", BarChart3],
  ["DST Streamers", ShieldCheck],
  ["My Leagues", Trophy],
  ["Trades", ArrowRightLeft],
  ["Waivers & FAAB", WalletCards],
  ["News & Roles", Newspaper],
] as const;
type Screen = (typeof navItems)[number][0];

function Index() {
  const [screen, setScreen] = useState<Screen>("Overall Rankings");
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <Sidebar
        screen={screen}
        onSelect={(next) => {
          setScreen(next);
          setMobileOpen(false);
        }}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <main className="min-w-0 flex-1 lg:ml-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b-[3px] border-b-volt bg-background/95 px-4 backdrop-blur md:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-hot">
                Fantasy football
              </p>
              <h1 className="font-display text-xl font-semibold md:text-2xl">{screen}</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
          </div>
        </header>
        <div
          key={screen}
          className="mx-auto max-w-[1480px] px-4 py-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 md:px-8 lg:px-10 lg:py-8"
        >
          {screen === "Overall Rankings" ? (
            <PersonalRankings key="rankings" />
          ) : screen === "Weekly Rankings" ? (
            <PersonalRankings key="weekly" weeklyOnly />
          ) : screen === "DST Streamers" ? (
            <PersonalRankings key="dst" defensesOnly />
          ) : screen === "Trades" ? (
            <Trades />
          ) : screen === "Waivers & FAAB" ? (
            <WaiversFaab />
          ) : screen === "My Leagues" ? (
            <MyLeagues />
          ) : (
            <FutureScreen screen={screen} />
          )}
        </div>
      </main>
    </div>
  );
}

function Sidebar({
  screen,
  onSelect,
  open,
  onClose,
}: {
  screen: Screen;
  onSelect: (s: Screen) => void;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-sidebar/50 backdrop-blur-sm lg:hidden ${open ? "block" : "hidden"}`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:visible lg:translate-x-0 ${open ? "visible translate-x-0" : "invisible -translate-x-full"}`}
      >
        <div className="flex h-20 items-center justify-between border-b border-sidebar-foreground/10 px-6">
          <Button
            variant="ghost"
            onClick={() => onSelect("Overall Rankings")}
            className="h-auto gap-3 p-0 text-left text-sidebar-foreground hover:bg-transparent hover:text-sidebar-foreground"
          >
            <span className="grid h-9 w-9 -skew-x-6 place-items-center rounded-md bg-volt text-volt-foreground">
              <Gauge className="h-5 w-5" />
            </span>
            <span>
              <strong className="block font-display text-xl leading-none">Fantasy HQ</strong>
              <span className="text-[10px] uppercase tracking-widest text-sidebar-muted">
                Your leagues, your board
              </span>
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X />
          </Button>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-6">
          {navItems.map(([label, Icon]) => (
            <Button
              key={label}
              variant="ghost"
              onClick={() => onSelect(label)}
              className={`h-auto w-full justify-start px-3 py-2.5 text-left font-medium transition-colors ${screen === label ? "bg-volt text-volt-foreground hover:bg-volt hover:text-volt-foreground" : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {screen === label && <ChevronRight className="ml-auto h-4 w-4" />}
            </Button>
          ))}
        </nav>
        <div className="border-t border-sidebar-foreground/10 p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-sidebar-foreground" />
            <p className="text-xs leading-5 text-sidebar-muted">
              Your fantasy workspace
              <br />
              <span className="text-sidebar-foreground">League lookup stays in your browser</span>
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

function InfoRow({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[120px_1fr]">
      <dt className="font-semibold text-muted-foreground">{term}</dt>
      <dd>{detail}</dd>
    </div>
  );
}
type SleeperLeague = {
  league_id: string;
  name: string;
  total_rosters: number;
  scoring_settings?: Record<string, number>;
  roster_positions?: string[];
};
function MyLeagues() {
  const [username, setUsername] = useState("");
  const [season, setSeason] = useState("2026");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  async function lookup(event: FormEvent) {
    event.preventDefault();
    const name = username.trim();
    if (!name) return;
    setLoading(true);
    setError("");
    setLeagues([]);
    try {
      const userResponse = await fetch(
        `https://api.sleeper.app/v1/user/${encodeURIComponent(name)}`,
      );
      if (!userResponse.ok) throw new Error("Sleeper could not find that username.");
      const user = (await userResponse.json()) as { user_id?: string };
      if (!user.user_id) throw new Error("Sleeper could not find that username.");
      const response = await fetch(
        `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${season}`,
      );
      if (!response.ok) throw new Error("Sleeper leagues could not be loaded right now.");
      setLeagues((await response.json()) as SleeperLeague[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sleeper is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <section className="border-b pb-7">
        <p className="broadcast-tag text-xs uppercase">Optional connection</p>
        <h2 className="mt-2 font-display text-3xl font-semibold md:text-4xl">
          Bring your league context into view.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Read-only lookup through Sleeper’s public service. Nothing is submitted or saved.
        </p>
      </section>
      <section className="rounded-lg border bg-card p-5 md:p-7">
        <form onSubmit={lookup} className="grid gap-4 md:grid-cols-[1fr_140px_auto] md:items-end">
          <label className="text-sm font-semibold">
            Sleeper username
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="partyeh"
              className="mt-2"
            />
          </label>
          <label className="text-sm font-semibold">
            Season
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option>2026</option>
              <option>2025</option>
              <option>2024</option>
              <option>2023</option>
            </select>
          </label>
          <Button type="submit" disabled={!username.trim() || loading}>
            <Search />
            {loading ? "Looking up…" : "Find leagues"}
          </Button>
        </form>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning"
          >
            {error}
          </p>
        )}
      </section>
      {leagues.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2">
          {leagues.map((league) => (
            <article key={league.league_id} className="rounded-lg border bg-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Sleeper league</p>
                  <h3 className="mt-1 font-display text-xl font-semibold">{league.name}</h3>
                </div>
                <span className="rounded-sm bg-muted px-2 py-1 text-xs">
                  {league.total_rosters} teams
                </span>
              </div>
              <div className="mt-5 space-y-3 text-sm">
                <InfoRow term="Scoring" detail={formatScoring(league.scoring_settings)} />
                <InfoRow term="Lineup slots" detail={formatPositions(league.roster_positions)} />
              </div>
            </article>
          ))}
        </section>
      ) : (
        !error && <EmptyConnection />
      )}
    </div>
  );
}
function formatScoring(settings?: Record<string, number>) {
  if (!settings) return "Not reported";
  const rec = settings["rec"];
  return rec === 1
    ? "Full PPR"
    : rec === 0.5
      ? "Half PPR"
      : rec === 0
        ? "Standard"
        : `Custom (${rec ?? "unknown"} per reception)`;
}
function formatPositions(positions?: string[]) {
  return positions?.filter((p) => p !== "BN").join(" · ") || "Not reported";
}
function EmptyConnection() {
  return (
    <section className="grid min-h-[330px] place-items-center rounded-lg border border-dashed bg-card p-8 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-muted">
          <Users className="h-5 w-5 text-muted-foreground" />
        </span>
        <h3 className="mt-5 font-display text-2xl font-semibold">No league connected</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Enter a Sleeper username and choose a season to inspect league scoring and lineup slots.
          The connection remains browser-only and read-only.
        </p>
      </div>
    </section>
  );
}

function FutureScreen({ screen }: { screen: Screen }) {
  const copy: Partial<Record<Screen, [string, string]>> = {
    "Start / Sit": [
      "Compare your options",
      "Start/sit recommendations are not available yet. Browse Players to check player details and Sleeper status.",
    ],
    "News & Roles": [
      "Follow player availability",
      "Sourced injury and usage reports are not available yet. Sleeper status fields are available in Players.",
    ],
  };
  const [title, description] = copy[screen] ?? [screen, "No results available."];
  return <Placeholder title={title} copy={description} />;
}

function Placeholder({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="grid min-h-[240px] place-items-center rounded-lg border border-dashed bg-card p-7 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-md bg-muted">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
        </span>
        <h3 className="mt-5 font-display text-xl font-semibold">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
      </div>
    </div>
  );
}
