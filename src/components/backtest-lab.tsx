import { useState } from "react";
import { ArrowDown, ChevronDown, CircleHelp, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXPERIMENT, type Season } from "@/data/backtest-results";

const modelCopy = {
  recent: {
    title: "Recent games only",
    description: "Use a player's last four team games, giving the newest games more weight.",
  },
  opportunity: {
    title: "Smoothed efficiency",
    description:
      "Keep the same expected workload, but soften unusually hot or cold rates for yards, catches and touchdowns.",
  },
  matchup: {
    title: "Add the defensive matchup",
    description: "Start with smoothed efficiency, then adjust for the opponent's past results.",
  },
};

export function BacktestLab() {
  const [season, setSeason] = useState<Season>("2024");
  const data = EXPERIMENT.results[season];
  const baseline = data.models.find((model) => model.key === "recent");
  const opportunity = data.models.find((model) => model.key === "opportunity");
  if (!baseline || !opportunity) {
    return <p role="alert">The historical comparison is unavailable.</p>;
  }
  const gain = baseline.mae - opportunity.mae;

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 border-b pb-7 xl:flex-row xl:items-end">
        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-primary">
            Testing before trusting
          </p>
          <h2 className="font-display text-3xl font-semibold leading-tight md:text-4xl">
            Can we trust the projections yet?
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Not yet. We replayed past games using only earlier results to see how close our
            predictions would have been. This page shows what helped and what still needs work.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm text-muted-foreground">Season tested</span>
          <div
            className="flex rounded-md border bg-card p-1"
            role="group"
            aria-label="Season tested"
          >
            {(["2023", "2024"] as Season[]).map((year) => (
              <Button
                key={year}
                size="sm"
                variant={season === year ? "default" : "ghost"}
                aria-pressed={season === year}
                onClick={() => setSeason(year)}
              >
                {year}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section
        className="rounded-lg border border-primary/30 bg-success-soft/40 p-5 md:p-6"
        aria-label="What we learned"
      >
        <p className="text-xs font-bold uppercase tracking-wide text-primary">
          What this means for you
        </p>
        <h3 className="mt-2 font-display text-2xl font-semibold">
          Smoothing player performance helped a little. Our matchup adjustment hasn’t earned its
          place yet.
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          The first adjustment made predictions a bit closer in both seasons. Adding the opponent
          made almost no difference. That does not mean matchups don’t matter—it means this version
          of the matchup calculation needs more work.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label="Results at a glance">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">Average miss after smoothing</p>
          <p className="mt-2 font-display text-4xl font-semibold">
            {opportunity.mae.toFixed(1)} <span className="text-xl">points</span>
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Predictions were off by this many fantasy points on average, counting misses in either
            direction.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">Improvement over recent games only</p>
          <p className="mt-2 font-display text-4xl font-semibold text-primary">
            {gain.toFixed(2)} <span className="text-xl">points closer</span>
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            About {((gain / baseline.mae) * 100).toFixed(1)}% less average error. A modest
            improvement, not an accuracy percentage.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">How much we tested</p>
          <p className="mt-2 font-display text-4xl font-semibold">
            {data.sampleSize.toLocaleString()}
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Player-game predictions in {season}, Weeks 5–18. One player in one week counts as one
            prediction.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-5 py-4">
          <h3 className="font-semibold">Which approach came closest?</h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowDown className="h-4 w-4" aria-hidden="true" />A smaller average miss is better.
            All three use the same players and scoring.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Average full-PPR prediction errors for {season}. Lower values are better.
            </caption>
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th scope="col" className="px-5 py-3 font-semibold">
                  Approach
                </th>
                <th scope="col" className="whitespace-nowrap px-5 py-3 text-right font-semibold">
                  Average points off
                </th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((model) => (
                <tr key={model.key} className="border-b last:border-0">
                  <th scope="row" className="px-5 py-5 text-left font-normal">
                    <p className="font-semibold">{modelCopy[model.key].title}</p>
                    <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                      {modelCopy[model.key].description}
                    </p>
                  </th>
                  <td className="px-5 py-5 text-right font-mono text-xl">{model.mae.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-5 py-4 text-xs leading-5 text-muted-foreground">
          Full PPR · 4 points per passing touchdown · −2 per interception. These are historical
          error scores, not next week’s player projections.
        </p>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <CircleHelp className="h-5 w-5 text-primary" aria-hidden="true" />
          <h3 className="mt-3 font-semibold">What does “points off” mean?</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            If we predict 15 points and a player scores 10, we missed by 5. If he scores 20, we also
            missed by 5. We average those misses across every prediction.
          </p>
          <p className="mt-3 text-sm font-medium">
            A {opportunity.mae.toFixed(1)}-point average miss does not mean every result falls
            within {opportunity.mae.toFixed(1)} points. Some misses are much larger.
          </p>
        </div>
        <div className="rounded-lg border border-warning/30 bg-warning-soft/30 p-5">
          <FlaskConical className="h-5 w-5 text-warning" aria-hidden="true" />
          <h3 className="mt-3 font-semibold">What needs to happen next?</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Add reliable historical injury information, improve player roles and team trends, then
            test again. Injury and availability reports will carry substantial weight; coach usage
            comments are a separate, weaker signal.
          </p>
          <p className="mt-3 text-sm font-medium">
            2025 is saved for the final check. These results are not ready for start/sit or betting
            decisions.
          </p>
        </div>
      </section>

      <details className="group rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          How we tested it & technical details
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-6 border-t p-5">
          <p className="text-sm leading-6 text-muted-foreground">
            {season === "2023"
              ? "2023 was the development season."
              : "2024 was the validation season."}{" "}
            Neither is the untouched final test. We selected players before seeing their results:
            this comparison includes those projected for at least 5 full-PPR points by the
            recent-games approach. Selected players with no stat row still count as zero-point
            outcomes.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <caption className="sr-only">Detailed error metrics</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-3 pr-4">
                    Approach
                  </th>
                  <th scope="col" className="p-3 text-right">
                    MAE
                  </th>
                  <th scope="col" className="p-3 text-right">
                    RMSE
                  </th>
                  <th scope="col" className="py-3 pl-3 text-right">
                    Bias
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((model) => (
                  <tr key={model.key} className="border-b">
                    <th scope="row" className="py-3 pr-4 text-left font-medium">
                      {modelCopy[model.key].title}
                    </th>
                    <td className="p-3 text-right font-mono">{model.mae.toFixed(3)}</td>
                    <td className="p-3 text-right font-mono">{model.rmse.toFixed(3)}</td>
                    <td className="py-3 pl-3 text-right font-mono">
                      {model.bias > 0 ? "+" : ""}
                      {model.bias.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="grid gap-4 text-sm md:grid-cols-3">
            <div>
              <dt className="font-semibold">MAE: average miss</dt>
              <dd className="mt-1 leading-6 text-muted-foreground">
                The same “average points off” shown above. Every missed point counts equally.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">RMSE: emphasizes big misses</dt>
              <dd className="mt-1 leading-6 text-muted-foreground">
                Another error measure that penalizes a few very large misses more heavily. Lower is
                better.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Bias: too high or too low?</dt>
              <dd className="mt-1 leading-6 text-muted-foreground">
                Positive means we overpredicted on average; negative means we underpredicted. Closer
                to zero is better.
              </dd>
            </div>
          </dl>
          <div className="space-y-4 border-t pt-5">
            <h4 className="font-semibold">Could the improvement just be noise?</h4>
            {data.improvements.map((item) => (
              <div key={item.comparison} className="rounded-md bg-muted/50 p-4">
                <p className="text-sm font-medium">
                  {item.comparison === "Recent → Opportunity"
                    ? "Smoothing compared with recent games only"
                    : "Adding matchups compared with smoothing alone"}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Estimated reduction in average error: {item.value.toFixed(3)} points. Diagnostic
                  95% range: {item.low.toFixed(3)} to {item.high.toFixed(3)}.{" "}
                  {item.low <= 0 && item.high >= 0
                    ? "The range crosses zero, so this test does not show a clear benefit."
                    : "The range stays above zero, supporting a modest improvement in this replay."}
                </p>
              </div>
            ))}
            <p className="text-xs leading-5 text-muted-foreground">
              These ranges come from resampling two-week blocks. Each season has only 14 evaluated
              weeks, and repeated players limit the strength of the evidence. This is a diagnostic
              comparison, not proof of future accuracy.
            </p>
          </div>
          <p className="border-t pt-5 text-sm leading-6 text-muted-foreground">
            Still missing: injury inputs, Weeks 1–4, players without prior usage, a separate
            team-pace model, reliable ceiling probabilities, and jointly consistent QB/receiver
            totals. Historical stat corrections and stale team membership after transfers can also
            affect this replay.
          </p>
        </div>
      </details>
    </div>
  );
}
