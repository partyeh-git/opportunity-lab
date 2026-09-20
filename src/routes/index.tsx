import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  Activity, ArrowRightLeft, BarChart3, BookOpen, ChevronRight, CircleDot,
  FlaskConical, Gauge, LayoutDashboard, Menu, Newspaper, Search, ShieldCheck,
  Target, TrendingDown, Trophy, Users, WalletCards, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXPERIMENT, type Season } from "@/data/backtest-results";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Opportunity Lab — Fantasy Football Research" },
    { name: "description", content: "An honest, explainable fantasy-football analytics research workspace." },
    { property: "og:title", content: "Opportunity Lab — Fantasy Football Research" },
    { property: "og:description", content: "An honest, explainable fantasy-football analytics research workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

const navItems = [
  ["Overview", LayoutDashboard], ["Backtest Lab", FlaskConical], ["Weekly Projections", BarChart3],
  ["My Leagues", Trophy], ["Trades", ArrowRightLeft], ["Waivers & FAAB", WalletCards], ["News & Roles", Newspaper],
] as const;
type Screen = (typeof navItems)[number][0];

function Index() {
  const [screen, setScreen] = useState<Screen>("Backtest Lab");
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div className="min-h-screen bg-background text-foreground lg:flex">
    <Sidebar screen={screen} onSelect={(next) => { setScreen(next); setMobileOpen(false); }} open={mobileOpen} onClose={() => setMobileOpen(false)} />
    <main className="min-w-0 flex-1 lg:ml-64">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:px-8 lg:px-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button>
          <div><p className="text-xs font-semibold uppercase text-muted-foreground">Workspace</p><h1 className="font-display text-xl font-semibold md:text-2xl">{screen}</h1></div>
        </div>
        <div className="hidden items-center gap-2 text-xs font-medium text-muted-foreground sm:flex"><span className="h-2 w-2 rounded-full bg-warning" />Research preview <span className="text-border">•</span> 2025 test season locked</div>
      </header>
      <div className="mx-auto max-w-[1480px] px-4 py-6 md:px-8 lg:px-10 lg:py-8">
        <div className="mb-5 flex items-center gap-2 text-xs font-medium text-muted-foreground sm:hidden"><span className="h-2 w-2 rounded-full bg-warning" />Research preview • 2025 test season locked</div>
        {screen === "Backtest Lab" ? <BacktestLab /> : screen === "My Leagues" ? <MyLeagues /> : <FutureScreen screen={screen} />}
      </div>
    </main>
  </div>;
}

function Sidebar({ screen, onSelect, open, onClose }: { screen: Screen; onSelect: (s: Screen) => void; open: boolean; onClose: () => void }) {
  return <><div className={`fixed inset-0 z-30 bg-sidebar/50 backdrop-blur-sm lg:hidden ${open ? "block" : "hidden"}`} onClick={onClose} />
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-20 items-center justify-between border-b border-sidebar-foreground/10 px-6">
        <Button variant="ghost" onClick={() => onSelect("Backtest Lab")} className="h-auto gap-3 p-0 text-left text-sidebar-foreground hover:bg-transparent hover:text-sidebar-foreground"><span className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground"><Gauge className="h-5 w-5" /></span><span><strong className="block font-display text-lg">Opportunity Lab</strong><span className="text-[10px] uppercase text-sidebar-muted">Decision research</span></span></Button>
        <Button variant="ghost" size="icon" className="text-sidebar-foreground lg:hidden" onClick={onClose} aria-label="Close navigation"><X /></Button>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-6">{navItems.map(([label, Icon]) => <Button key={label} variant="ghost" onClick={() => onSelect(label)} className={`h-auto w-full justify-start px-3 py-2.5 text-left font-normal ${screen === label ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"}`}><Icon className="h-4 w-4" />{label}{screen === label && <ChevronRight className="ml-auto h-4 w-4" />}</Button>)}</nav>
      <div className="border-t border-sidebar-foreground/10 p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 text-success-soft" /><p className="text-xs leading-5 text-sidebar-muted">Private research draft<br/><span className="text-sidebar-foreground">Local data only</span></p></div></div>
    </aside></>;
}

function BacktestLab() {
  const [season, setSeason] = useState<Season>("2024");
  const data = EXPERIMENT.results[season];
  const bestMae = Math.min(...data.models.map((m) => m.mae));
  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-5 border-b pb-7 xl:flex-row xl:items-end">
      <div className="max-w-3xl"><p className="mb-2 text-xs font-bold uppercase text-primary">Measured experiment 01</p><h2 className="font-display text-3xl font-semibold leading-tight md:text-4xl">Does opportunity stabilize the signal?</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">A locked historical replay comparing recent production, stabilized efficiency, and an initial matchup adjustment.</p></div>
      <div className="flex rounded-md border bg-card p-1" aria-label="Season selector">{(["2023", "2024"] as Season[]).map((year) => <Button key={year} size="sm" variant={season === year ? "default" : "ghost"} onClick={() => setSeason(year)}>{year}</Button>)}</div>
    </section>

    <section className="grid gap-3 sm:grid-cols-3">
      <Stat label="Evaluation set" value={`${data.sampleSize.toLocaleString()} rows`} note="Primary cohort" />
      <Stat label="Best observed MAE" value={bestMae.toFixed(6)} note={`${data.models.find((m) => m.mae === bestMae)?.label} model`} emphasis />
      <Stat label="Scoring" value="Full PPR" note="4 pt pass TD · −2 INT" />
    </section>

    <section className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-5 py-4"><div><h3 className="font-semibold">Model comparison</h3><p className="text-xs text-muted-foreground">Lower error is better; positive bias means overprojection.</p></div><span className="rounded-sm bg-muted px-2 py-1 text-xs font-semibold">{season}</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b bg-muted/55 text-left text-xs uppercase text-muted-foreground"><th className="px-5 py-3 font-semibold">Model</th><th className="px-4 py-3 text-right font-semibold">MAE</th><th className="px-4 py-3 text-right font-semibold">RMSE</th><th className="px-5 py-3 text-right font-semibold">Bias</th></tr></thead><tbody>{data.models.map((model) => <tr key={model.key} className="border-b last:border-0"><td className="px-5 py-4"><div className="flex items-center gap-2 font-semibold">{model.label}{model.mae === bestMae && <span className="rounded-sm bg-success-soft px-1.5 py-0.5 text-[10px] uppercase text-success">Lowest</span>}</div><p className="mt-1 text-xs text-muted-foreground">{model.description}</p></td><td className="px-4 py-4 text-right font-mono">{model.mae.toFixed(6)}</td><td className="px-4 py-4 text-right font-mono">{model.rmse.toFixed(6)}</td><td className="px-5 py-4 text-right font-mono">+{model.bias.toFixed(6)}</td></tr>)}</tbody></table></div>
      </div>
      <div className="rounded-lg border bg-card p-5"><div className="flex items-start justify-between"><div><h3 className="font-semibold">Mean absolute error</h3><p className="mt-1 text-xs text-muted-foreground">Fantasy points per player-week</p></div><TrendingDown className="h-5 w-5 text-primary" /></div><div className="mt-8 space-y-7">{data.models.map((model) => <div key={model.key}><div className="mb-2 flex justify-between text-xs"><span className="font-medium">{model.shortLabel}</span><span className="font-mono">{model.mae.toFixed(3)}</span></div><div className="h-3 overflow-hidden rounded-sm bg-muted"><div className={`h-full rounded-sm ${model.key === "recent" ? "bg-ink-soft" : model.key === "opportunity" ? "bg-primary" : "bg-warning"}`} style={{ width: `${(model.mae / 7) * 100}%` }} /></div></div>)}</div><p className="mt-7 border-t pt-4 text-xs leading-5 text-muted-foreground">Axis begins at zero. Small visual gaps are preserved rather than exaggerated.</p></div>
    </section>

    <section className="rounded-lg border border-primary/25 bg-success-soft/50 p-5 md:p-6"><div className="flex gap-4"><span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"><Target className="h-4 w-4" /></span><div><p className="text-xs font-bold uppercase text-primary">Takeaway</p><h3 className="mt-1 font-display text-xl font-semibold md:text-2xl">Efficiency stabilization helped in this replay; the initial matchup adjustment has no clear benefit.</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">These are development and validation results, not proof of production accuracy.</p></div></div></section>

    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-lg border bg-card p-5"><h3 className="font-semibold">Diagnostic uncertainty</h3><p className="mt-1 text-xs text-muted-foreground">95% two-week-block-bootstrap MAE improvements</p><div className="mt-5 space-y-4">{data.improvements.map((item) => <div key={item.comparison} className="border-l-2 pl-4" style={{ borderColor: item.clear ? "var(--success)" : "var(--warning)" }}><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">{item.comparison}</span><span className={`rounded-sm px-2 py-1 text-xs font-semibold ${item.clear ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>{item.clear ? "Clear improvement" : "No clear benefit"}</span></div><p className="mt-2 font-mono text-sm">{item.value >= 0 ? "+" : ""}{item.value.toFixed(6)} <span className="text-muted-foreground">[{item.low.toFixed(6)}, {item.high.toFixed(6)}]</span></p></div>)}</div></div>
      <div className="rounded-lg border bg-card p-5"><h3 className="font-semibold">Experiment definition</h3><dl className="mt-4 divide-y text-sm"><InfoRow term="Scoring" detail={EXPERIMENT.scoring} /><InfoRow term="Window" detail={EXPERIMENT.window} /><InfoRow term="Cohort" detail={EXPERIMENT.cohort} /><InfoRow term="Missing targets" detail="Target-week stat rows score zero rather than being removed" /></dl></div>
    </section>
    <Notes />
  </div>;
}

function Stat({ label, value, note, emphasis = false }: { label: string; value: string; note: string; emphasis?: boolean }) { return <div className="border-t-2 bg-card px-5 py-4" style={{ borderColor: emphasis ? "var(--success)" : "var(--border)" }}><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>; }
function InfoRow({ term, detail }: { term: string; detail: string }) { return <div className="grid gap-1 py-3 sm:grid-cols-[120px_1fr]"><dt className="font-semibold text-muted-foreground">{term}</dt><dd>{detail}</dd></div>; }
function Notes() { return <section className="grid gap-5 border-t pt-7 lg:grid-cols-3"><div><BookOpen className="h-5 w-5 text-primary"/><h3 className="mt-3 font-semibold">What changed</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">The opportunity model uses the same weighted recent volume as recent form and stabilizes efficiency. A separate team pace model is not built yet.</p></div><div><CircleDot className="h-5 w-5 text-warning"/><h3 className="mt-3 font-semibold">Not modeled yet</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Injuries, Weeks 1–4, cold-start rookie forecasts, calibrated ceilings, and betting outputs are excluded.</p></div><div><Activity className="h-5 w-5 text-ink-soft"/><h3 className="mt-3 font-semibold">Known limitations</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Historical stat corrections and last-observed team membership remain limitations of this replay.</p></div></section>; }

type SleeperLeague = { league_id: string; name: string; total_rosters: number; scoring_settings?: Record<string, number>; roster_positions?: string[] };
function MyLeagues() {
  const [username, setUsername] = useState(""); const [season, setSeason] = useState("2026"); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  async function lookup(event: FormEvent) { event.preventDefault(); const name = username.trim(); if (!name) return; setLoading(true); setError(""); setLeagues([]); try { const userResponse = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(name)}`); if (!userResponse.ok) throw new Error("Sleeper could not find that username."); const user = await userResponse.json() as { user_id?: string }; if (!user.user_id) throw new Error("Sleeper could not find that username."); const response = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${season}`); if (!response.ok) throw new Error("Sleeper leagues could not be loaded right now."); setLeagues(await response.json() as SleeperLeague[]); } catch (reason) { setError(reason instanceof Error ? reason.message : "Sleeper is unavailable right now."); } finally { setLoading(false); } }
  return <div className="mx-auto max-w-5xl space-y-7"><section className="border-b pb-7"><p className="text-xs font-bold uppercase text-primary">Optional connection</p><h2 className="mt-2 font-display text-3xl font-semibold md:text-4xl">Bring your league context into view.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Read-only lookup through Sleeper’s public service. Nothing is submitted or saved.</p></section><section className="rounded-lg border bg-card p-5 md:p-7"><form onSubmit={lookup} className="grid gap-4 md:grid-cols-[1fr_140px_auto] md:items-end"><label className="text-sm font-semibold">Sleeper username<Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="partyeh" className="mt-2" /></label><label className="text-sm font-semibold">Season<select value={season} onChange={(e) => setSeason(e.target.value)} className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option>2026</option><option>2025</option><option>2024</option><option>2023</option></select></label><Button type="submit" disabled={!username.trim() || loading}><Search />{loading ? "Looking up…" : "Find leagues"}</Button></form>{error && <p role="alert" className="mt-4 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">{error}</p>}</section>{leagues.length > 0 ? <section className="grid gap-4 md:grid-cols-2">{leagues.map((league) => <article key={league.league_id} className="rounded-lg border bg-card p-5"><div className="flex items-start justify-between"><div><p className="text-xs uppercase text-muted-foreground">Sleeper league</p><h3 className="mt-1 font-display text-xl font-semibold">{league.name}</h3></div><span className="rounded-sm bg-muted px-2 py-1 text-xs">{league.total_rosters} teams</span></div><div className="mt-5 space-y-3 text-sm"><InfoRow term="Scoring" detail={formatScoring(league.scoring_settings)} /><InfoRow term="Lineup slots" detail={formatPositions(league.roster_positions)} /></div></article>)}</section> : !error && <EmptyConnection />}</div>;
}
function formatScoring(settings?: Record<string, number>) { if (!settings) return "Not reported"; const rec = settings["rec"]; return rec === 1 ? "Full PPR" : rec === 0.5 ? "Half PPR" : rec === 0 ? "Standard" : `Custom (${rec ?? "unknown"} per reception)`; }
function formatPositions(positions?: string[]) { return positions?.filter((p) => p !== "BN").join(" · ") || "Not reported"; }
function EmptyConnection() { return <section className="grid min-h-[330px] place-items-center rounded-lg border border-dashed bg-card p-8 text-center"><div className="max-w-md"><span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-muted"><Users className="h-5 w-5 text-muted-foreground" /></span><h3 className="mt-5 font-display text-2xl font-semibold">No league connected</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter a Sleeper username and choose a season to inspect league scoring and lineup slots. The connection remains browser-only and read-only.</p></div></section>; }

function FutureScreen({ screen }: { screen: Screen }) {
  if (screen === "Overview") return <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]"><section className="border-b pb-8 lg:col-span-2"><p className="text-xs font-bold uppercase text-primary">Private research workspace</p><h2 className="mt-2 max-w-3xl font-display text-4xl font-semibold">Make fewer claims. Make better decisions.</h2><p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">Opportunity Lab is being built around measured evidence, visible uncertainty, and league-specific context.</p></section><div className="rounded-lg border bg-card p-6"><FlaskConical className="text-primary"/><h3 className="mt-8 font-display text-2xl font-semibold">Backtest Lab</h3><p className="mt-2 text-sm text-muted-foreground">Two locked seasons. Three models. Exact measured results.</p></div><div className="rounded-lg border bg-card p-6"><Trophy className="text-warning"/><h3 className="mt-8 font-display text-2xl font-semibold">League context</h3><p className="mt-2 text-sm text-muted-foreground">Optional read-only Sleeper lookup is ready.</p></div></div>;
  const isTrade = screen === "Trades"; const isFaab = screen === "Waivers & FAAB"; const isNews = screen === "News & Roles";
  return <div className="space-y-7"><section className="border-b pb-7"><p className="text-xs font-bold uppercase text-primary">Designed for later integration</p><h2 className="mt-2 font-display text-3xl font-semibold md:text-4xl">{screen}</h2><p className="mt-3 text-sm text-muted-foreground">Projection engine integration pending</p></section>
    {isTrade && <div className="grid gap-4 lg:grid-cols-2"><Placeholder title="Your side" copy="Select players and picks after roster data is available."/><Placeholder title="Their side" copy="No trade values or recommendations are generated yet."/><div className="rounded-lg border bg-card p-5 lg:col-span-2"><h3 className="font-semibold">Future evaluation checklist</h3><div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">{["Legal lineup improvement","Required roster drops","Bye-week effects","Keeper surplus"].map(x=><span key={x} className="rounded-md bg-muted p-3">{x}</span>)}</div></div></div>}
    {isFaab && <div className="grid gap-4 md:grid-cols-3">{[["Expected acquisition cost","Market estimate"],["Value to your roster","League-specific gain"],["Recommended bid / ceiling","Decision boundary"]].map(([a,b])=><div key={a} className="rounded-lg border bg-card p-5"><p className="text-xs uppercase text-muted-foreground">{b}</p><p className="mt-8 font-display text-xl font-semibold">{a}</p><p className="mt-2 text-sm text-warning">Unset until modeled</p></div>)}<div className="rounded-lg border bg-card p-5 md:col-span-3"><h3 className="font-semibold">Keeper rules — draft specification</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">Optional up to 3 keepers. Drafted players cost one round earlier with a three-year maximum; edge cases require clarification. Waiver keepers cost the final draft pick, then eighth, then fourth.</p></div></div>}
    {isNews && <div className="grid gap-4 lg:grid-cols-2"><Placeholder title="Injury & availability" copy="High-impact reports will show source, time, confidence, and expiry."/><Placeholder title="Usage & strategy" copy="Weaker coach comments remain clearly separated, sourced, timed, and expirable."/></div>}
    {!isTrade && !isFaab && !isNews && <Placeholder title="No rankings displayed" copy="This screen will remain empty until reproducible projection outputs are connected."/>}
  </div>;
}
function Placeholder({ title, copy }: { title: string; copy: string }) { return <div className="grid min-h-[240px] place-items-center rounded-lg border border-dashed bg-card p-7 text-center"><div className="max-w-sm"><span className="mx-auto grid h-11 w-11 place-items-center rounded-md bg-muted"><BarChart3 className="h-5 w-5 text-muted-foreground" /></span><h3 className="mt-5 font-display text-xl font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p></div></div>; }
