import { CloudRain, Snowflake, Wind } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchPublicJson } from "@/lib/live-data";

// Kickoff forecast per team for the week on the site (public/weather.json, refreshed with the
// projections). Display only: the 9/27 study found the betting total already prices most weather.
export type GameWeather = {
  kickoff: string;
  stadium: string;
  opponent: string;
  home: boolean;
  outdoor: boolean;
  flags: ("rain" | "snow" | "wind")[];
  tempF?: number;
  windMph?: number;
  gustMph?: number;
  precipIn?: number;
  precipChance?: number | null;
  snowIn?: number;
};
type WeatherFile = {
  generatedAt: string;
  season: number;
  week: number;
  teams: Record<string, GameWeather>;
};

export function useWeather(week: number) {
  const query = useQuery({
    queryKey: ["weather"],
    queryFn: () => fetchPublicJson<WeatherFile>("weather.json"),
    staleTime: 30 * 60 * 1000,
  });
  const file = query.data?.week === week ? query.data : null;
  return (team: string) => (file ? { game: file.teams[team], updated: file.generatedAt } : null);
}

const ICONS = { rain: CloudRain, snow: Snowflake, wind: Wind } as const;
const LABELS = { rain: "Rain", snow: "Snow", wind: "Wind" } as const;

function kickoffLabel(kickoff: string) {
  const d = new Date(`${kickoff}:00`);
  return Number.isNaN(d.getTime())
    ? kickoff
    : `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} ET`;
}

/** One icon per weather flag; click for the forecast numbers behind it. */
export function WeatherIcons({
  weather,
}: {
  weather: { game: GameWeather | undefined; updated: string } | null;
}) {
  const game = weather?.game;
  if (!game || !game.outdoor || !game.flags.length) return null;
  const what = game.flags.map((f) => LABELS[f]).join(" and ");
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${what} forecast`}
        title={`${what} forecast: click for details`}
        className="ml-2 inline-flex items-center gap-0.5 rounded-sm align-middle text-sky-600 hover:text-sky-500 focus-visible:ring-2 focus-visible:ring-primary dark:text-sky-400"
      >
        {game.flags.map((f) => {
          const Icon = ICONS[f];
          return <Icon key={f} className="h-4 w-4" aria-hidden="true" />;
        })}
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 text-xs leading-5">
        <p className="font-semibold">
          {what} forecast · {game.stadium}, {kickoffLabel(game.kickoff)}
        </p>
        <ul className="space-y-0.5">
          {game.flags.includes("rain") && (
            <li>
              Rain: {game.precipIn?.toFixed(2)} in expected over the game
              {game.precipChance != null && `, ${game.precipChance}% chance`}
            </li>
          )}
          {game.flags.includes("snow") && <li>Snow: {game.snowIn?.toFixed(1)} in expected</li>}
          <li className={game.flags.includes("wind") ? "font-semibold" : ""}>
            Wind: {game.windMph} mph{game.gustMph != null && `, gusts to ${game.gustMph}`}
          </li>
          <li>Temperature: {game.tempF}°F at kickoff</li>
        </ul>
        <p className="text-muted-foreground">
          Past seasons: rain trimmed WRs about 1.3 points and helped defenses about 1 point; strong
          wind trims passing (QB, TE, WR). The betting total already prices most of this, so
          projections are not changed.
        </p>
        <p className="text-muted-foreground">
          Forecast updated{" "}
          {new Date(weather!.updated).toLocaleString(undefined, {
            dateStyle: "short",
            timeStyle: "short",
          })}
          .
        </p>
      </PopoverContent>
    </Popover>
  );
}
