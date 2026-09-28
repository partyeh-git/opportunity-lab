import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadSnapshots } from "@/lib/snapshots";
import {
  ArrowRightLeft,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Gauge,
  Menu,
  WalletCards,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Trades } from "@/components/rankings-trades";
import { PersonalRankings } from "@/components/personal-rankings";
import { WaiversFaab } from "@/components/waivers-faab";
import { ConnectBanner, LeagueProvider, LeagueSwitcher } from "@/components/league-context";
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
      <SnapshotGate>
        <Index />
      </SnapshotGate>
    </LeagueProvider>
  ),
});

// Home and Start / Sit join the menu once they are built (no placeholder pages).
const navItems = [
  ["Overall Rankings", BarChart3],
  ["Weekly Rankings", CalendarDays],
  ["Trades", ArrowRightLeft],
  ["Waivers & FAAB", WalletCards],
] as const;
type Screen = (typeof navItems)[number][0];

// The weekly projections load from GitHub at startup (lib/snapshots); screens read them after.
function SnapshotGate({ children }: { children: ReactNode }) {
  const snapshots = useQuery({
    queryKey: ["snapshots"],
    queryFn: loadSnapshots,
    staleTime: Infinity,
    retry: 2,
  });
  if (snapshots.isSuccess) return <>{children}</>;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
      {snapshots.isError
        ? "Projections didn't load. Refresh to try again."
        : "Loading projections…"}
    </div>
  );
}

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
          window.scrollTo(0, 0);
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
              <p className="hidden text-xs font-semibold uppercase tracking-wide text-hot sm:block">
                Fantasy football
              </p>
              <h1 className="font-display text-xl font-semibold md:text-2xl">{screen}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <LeagueSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <div
          key={screen}
          className="mx-auto max-w-[1480px] px-4 py-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 md:px-8 lg:px-10 lg:py-8"
        >
          <ConnectBanner />
          {screen === "Overall Rankings" ? (
            <PersonalRankings key="rankings" />
          ) : screen === "Weekly Rankings" ? (
            <PersonalRankings key="weekly" weeklyOnly />
          ) : screen === "Trades" ? (
            <Trades />
          ) : (
            <WaiversFaab />
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
      </aside>
    </>
  );
}
