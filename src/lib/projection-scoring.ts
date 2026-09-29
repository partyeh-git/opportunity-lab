export type ProjectedStats = {
  passingYards: number;
  passingTds: number;
  passingInterceptions: number;
  rushingYards: number;
  rushingTds: number;
  receivingYards: number;
  receivingTds: number;
  receptions: number;
  fumblesLost: number;
  passing2pt: number;
  rushing2pt: number;
  receiving2pt: number;
  specialTeamsTds: number;
  fumbleRecoveryTds: number;
};

export function scoreProjectedStats(p: ProjectedStats, settings: Record<string, number>) {
  const v = (key: string, fallback: number) => settings[key] ?? fallback;
  return (
    p.passingYards * v("pass_yd", 0.04) +
    p.passingTds * v("pass_td", 4) +
    p.passingInterceptions * v("pass_int", -2) +
    p.rushingYards * v("rush_yd", 0.1) +
    p.rushingTds * v("rush_td", 6) +
    p.receivingYards * v("rec_yd", 0.1) +
    p.receivingTds * v("rec_td", 6) +
    p.receptions * v("rec", 1) +
    p.fumblesLost * v("fum_lost", -2) +
    p.passing2pt * v("pass_2pt", 2) +
    p.rushing2pt * v("rush_2pt", 2) +
    p.receiving2pt * v("rec_2pt", 2) +
    p.specialTeamsTds * v("st_td", 6) +
    p.fumbleRecoveryTds * v("fum_rec_td", 6)
  );
}

/** Fantasy seasons end in Week 17 (playoffs are Weeks 15 to 17); NFL Week 18 does not count. */
export const FANTASY_LAST_WEEK = 17;

export function scoreRemainingGames(
  player: { weeklyForecasts: { week: number; projected: ProjectedStats }[] },
  settings: Record<string, number>,
  endWeek = FANTASY_LAST_WEEK,
) {
  return player.weeklyForecasts
    .filter((g) => g.week <= endWeek)
    .reduce((sum, g) => sum + scoreProjectedStats(g.projected, settings), 0);
}
