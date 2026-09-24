"""Write public/sleeper-positions.json: Sleeper player id -> fantasy position (+ current rookies).

Sleeper transactions store only player ids, and the full Sleeper player file is ~15 MB, too
large for the browser. This small public lookup lets the Waivers & FAAB page group a league's
historical bids by position. Generic player data only; no league or bid information.

python scripts/build_sleeper_positions.py --players ../data/sleeper_players_2026.json
"""
import argparse
import json
from pathlib import Path

POSITIONS = ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--players', required=True, help='Sleeper /v1/players/nfl download')
    parser.add_argument('--output', default=str(Path(__file__).parents[1] / 'public' / 'sleeper-positions.json'))
    args = parser.parse_args()
    players = json.loads(Path(args.players).read_text(encoding='utf-8'))
    positions = {pid: p['position'] for pid, p in players.items() if p.get('position') in POSITIONS}
    rookies = sorted(pid for pid, p in players.items() if p.get('position') in POSITIONS and p.get('years_exp') == 0)
    Path(args.output).write_text(json.dumps({'positions': positions, 'rookies': rookies}, separators=(',', ':')),
                                 encoding='utf-8')
    print(f'{len(positions)} players, {len(rookies)} rookies')


if __name__ == '__main__':
    main()
