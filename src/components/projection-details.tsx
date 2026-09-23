type DetailPlayer = {
  position: string;
  workloadEvidence: {recentGames:number;recentWeight:number;priorAvailable:boolean;changedTeam:boolean};
  matchupFactors: Record<string,{factor:number;weightedOpportunities:number;reliability:number}>;
  weeklyForecasts: {week:number;opponent:string;full:number;half:number}[];
};

export function ProjectionDetails({player}: {player:DetailPlayer}) {
  const labels: Record<string,string> = {
    catch: `${player.position} catch rate`,receiving:`Receiving yards vs ${player.position}`,
    rushing:`Rushing yards vs ${player.position}`,passing:"QB passing yards",
    receiving_td:`Receiving TDs vs ${player.position}`,rushing_td:`Rushing TDs vs ${player.position}`,
    passing_td:"Passing TDs",interceptions:"Interceptions",
  };
  const relevant = player.position === "QB"
    ? ["passing","passing_td","interceptions","rushing","rushing_td"]
    : player.position === "RB"
      ? ["rushing","rushing_td","catch","receiving","receiving_td"]
      : ["catch","receiving","receiving_td"];
  return <details className="mt-2 max-w-lg text-xs font-normal text-muted-foreground">
    <summary className="cursor-pointer text-primary">Why this projection?</summary>
    <p className="my-2 leading-5">
      {player.workloadEvidence.priorAvailable
        ? `Recent usage has ${(player.workloadEvidence.recentWeight*100).toFixed(0)}% weight; the rest comes from prior-season usage${player.workloadEvidence.changedTeam ? ", discounted because the player changed teams" : ""}.`
        : "No prior-season player workload is available; this role estimate is especially uncertain."}
      {" "}These weights reflect limited evidence, not a statistical significance test.
    </p>
    <ul className="space-y-1">
      {relevant.map((key) => {
        const f=player.matchupFactors[key];
        if(!f)return null;
        const change=(f.factor-1)*100;
        return <li key={key}>{labels[key]}: {change>=0?"+":""}{change.toFixed(1)}%
          {" "}({(f.reliability*100).toFixed(0)}% evidence weight)</li>;
      })}
    </ul>
    <p className="my-2 leading-5">Each defensive category is estimated separately and moderated for sample size. Positive yardage and TD adjustments favor the player; a positive interception adjustment increases turnover risk.</p>
    <table className="my-2 w-full text-left">
      <caption className="mb-1 text-left">Remaining schedule · full / half PPR</caption>
      <thead><tr><th>Week</th><th>Opponent</th><th>Points</th></tr></thead>
      <tbody>{player.weeklyForecasts.map((g)=><tr key={g.week}><td>{g.week}</td><td>{g.opponent}</td><td>{g.full.toFixed(1)} / {g.half.toFixed(1)}</td></tr>)}</tbody>
    </table>
    <p className="leading-5">Byes are excluded. Future defensive effects fade toward average; workload stays at the current role estimate. Injury availability and future role changes are not yet modeled.</p>
  </details>;
}
