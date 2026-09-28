"""Kickoff weather forecast for the week on the site (display only; never a model input).

For each outdoor game of the week in src/data/rankings-current.json, pulls the free Open-Meteo
forecast for kickoff hour + 2 hours and writes public/weather.json keyed by team. Flags (from the
9/27 weather study): rain (0.1+ inches expected, or 0.03+ inches at 50%+ chance), snow, or sustained wind 20+ mph. Domes and retractable roofs are skipped.
"""
import argparse, json, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
STADIUMS = {'ATL97':(33.7554,-84.4008),'BAL00':(39.2780,-76.6227),'BOS00':(42.0909,-71.2643),'BUF00':(42.7738,-78.7870),
'CAR00':(35.2258,-80.8528),'CHI98':(41.8623,-87.6167),'CIN00':(39.0955,-84.5161),'CLE00':(41.5061,-81.6995),
'DAL00':(32.7473,-97.0945),'DEN00':(39.7439,-105.0201),'DET00':(42.3400,-83.0456),'GNB00':(44.5013,-88.0622),
'HOU00':(29.6847,-95.4107),'IND00':(39.7601,-86.1639),'JAX00':(30.3239,-81.6373),'KAN00':(39.0489,-94.4839),
'LAX01':(33.9535,-118.3392),'LON00':(51.5560,-0.2796),'LON02':(51.6043,-0.0664),'MEX00':(19.3029,-99.1505),
'MIA00':(25.9580,-80.2389),'MIN01':(44.9737,-93.2575),'NAS00':(36.1665,-86.7713),'NOR00':(29.9511,-90.0812),
'NYC01':(40.8135,-74.0745),'PHI00':(39.9008,-75.1675),'PHO00':(33.5276,-112.2626),'PIT00':(40.4468,-80.0158),
'SEA00':(47.5952,-122.3316),'SFO01':(37.4030,-121.9700),'TAM00':(27.9759,-82.5033),'VEG00':(36.0909,-115.1833),
'WAS00':(38.9076,-76.8645)}
BY_NAME = {'Tottenham Hotspur Stadium': 'LON02', 'Wembley Stadium': 'LON00'}  # schedule sometimes keeps the home team's id
RETRACTABLE = {'ATL97', 'DAL00', 'HOU00', 'IND00', 'PHO00'}  # roof usually closed or unknown until game day
RAIN_IN, RAIN_CHANCE, SNOW_IN, WIND_MPH = 0.1, 50, 0.1, 20


def forecast(lat, lon):
    url = (f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}'
           '&hourly=temperature_2m,precipitation,precipitation_probability,snowfall,wind_speed_10m,wind_gusts_10m'
           '&timezone=America%2FNew_York&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=16')
    for attempt in range(3):
        try:
            return json.load(urllib.request.urlopen(url, timeout=60))['hourly']
        except Exception:
            time.sleep(5)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data-dir', type=Path, default=ROOT/'.cache'/'weekly')
    ap.add_argument('--output', type=Path, default=ROOT/'public'/'weather.json')
    ap.add_argument('--week', type=int, help='default: the week the site shows')
    a = ap.parse_args()
    snap = json.loads((ROOT/'src/data/rankings-current.json').read_text())
    season, week = snap['season'], a.week or snap['week']
    g = pd.read_csv(a.data_dir/'games.csv', low_memory=False)
    g = g[g.season.eq(season) & g.week.eq(week) & g.game_type.eq('REG')]
    teams, cache = {}, {}
    for r in g.itertuples():
        sid = BY_NAME.get(r.stadium, r.stadium_id)
        outdoor = r.roof == 'outdoors' and sid in STADIUMS and sid not in RETRACTABLE
        kickoff = f'{r.gameday}T{r.gametime}'
        info = dict(gameId=r.game_id, kickoff=kickoff, stadium=r.stadium, outdoor=bool(outdoor), flags=[])
        if outdoor:
            if sid not in cache:
                cache[sid] = forecast(*STADIUMS[sid])
            h = cache[sid]
            if h:
                start = pd.Timestamp(kickoff).floor('h')
                x = pd.DataFrame(h).assign(time=lambda d: pd.to_datetime(d.time)).set_index('time').loc[start:start+pd.Timedelta(hours=2)]
                if len(x):
                    info.update(tempF=round(float(x.temperature_2m.iloc[0])), windMph=round(float(x.wind_speed_10m.mean())),
                                gustMph=round(float(x.wind_gusts_10m.max())), precipIn=round(float(x.precipitation.sum()), 2),
                                precipChance=int(x.precipitation_probability.max()) if x.precipitation_probability.notna().any() else None,
                                snowIn=round(float(x.snowfall.sum()), 1))
                    if info['snowIn'] >= SNOW_IN:
                        info['flags'].append('snow')
                    elif info['precipIn'] >= RAIN_IN or (info['precipIn'] >= 0.03 and (info['precipChance'] or 0) >= RAIN_CHANCE):
                        info['flags'].append('rain')
                    if info['windMph'] >= WIND_MPH:
                        info['flags'].append('wind')
        teams[r.home_team] = {**info, 'opponent': r.away_team, 'home': True}
        teams[r.away_team] = {**info, 'opponent': r.home_team, 'home': False}
    out = dict(generatedAt=datetime.now(timezone.utc).isoformat(timespec='seconds'), season=season, week=week,
               source='Open-Meteo forecast, kickoff hour + 2 hours; display only, not a projection input',
               thresholds=dict(rainInches=RAIN_IN, rainChance=RAIN_CHANCE, snowInches=SNOW_IN, windMph=WIND_MPH), teams=teams)
    a.output.write_text(json.dumps(out, indent=1))
    flagged = {t: v['flags'] for t, v in teams.items() if v['flags']}
    print(f'Week {week}: {len(teams)//2} games, flagged {flagged}')


if __name__ == '__main__':
    main()
