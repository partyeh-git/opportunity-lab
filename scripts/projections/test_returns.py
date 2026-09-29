import unittest
from datetime import datetime, timezone
import pandas as pd
from returns import RATES, apply_returns, chances, games_missed


def player(pid='p1', team='CHI', weeks=(4, 5, 6)):
    games = [dict(week=w, opponent='X', stats=dict(passingYards=200.), full=20., half=20.) for w in weeks]
    return dict(id=pid, team=team, games=games, week=games[0], rosFull=60., rosHalf=60.)


GAMES = pd.DataFrame([dict(season=2026, game_type='REG', week=4, gameday='2026-10-04', gametime='13:00',
                           home_team='CHI', away_team='NYJ')])
SCHEDULE = pd.DataFrame([dict(season=2026, week=w, team='CHI') for w in (1, 2, 3, 4, 5, 6)])
STATS = pd.DataFrame([dict(season=2026, week=w, player_id='p1') for w in (1, 2)])


class ReturnsTest(unittest.TestCase):
    def test_chances_never_fall_and_stay_below_healthy(self):
        for curve in RATES['curves'].values():
            rel = curve['relative']
            self.assertEqual(rel, sorted(rel))
            self.assertTrue(all(0 <= x <= 1 for x in rel))

    def test_stale_status_starts_one_game_later(self):
        curve = RATES['curves']['Out|0']['relative']
        self.assertEqual(chances('Out', 0, 3, fresh=False), curve[:3])
        self.assertEqual(chances('Out', 0, 3, fresh=True), [0., curve[0], curve[1]])

    def test_games_missed_counts_back_from_the_target_week(self):
        self.assertEqual(games_missed(STATS, SCHEDULE, 2026, 4, 'p1', 'CHI'), 1)

    def test_fade_scales_future_games_but_not_this_weeks_if_active_line(self):
        p = player()
        monday = datetime(2026, 9, 28, 14, tzinfo=timezone.utc).isoformat()
        n = apply_returns([p], {'p1': 'Out'}, STATS, SCHEDULE, GAMES, 2026, 4, monday)
        curve = RATES['curves']['Out|1']['relative']
        self.assertEqual(n, 1)
        self.assertAlmostEqual(p['games'][0]['full'], 20*curve[0])
        self.assertAlmostEqual(p['games'][2]['stats']['passingYards'], 200*curve[2])
        self.assertAlmostEqual(p['rosFull'], 20*sum(curve[:3]))
        self.assertEqual(p['week']['full'], 20.)
        self.assertEqual(p['week']['stats']['passingYards'], 200.)

    def test_fresh_status_rules_out_this_weeks_game(self):
        p = player()
        saturday = datetime(2026, 10, 3, 14, tzinfo=timezone.utc).isoformat()
        apply_returns([p], {'p1': 'IR'}, STATS, SCHEDULE, GAMES, 2026, 4, saturday)
        self.assertEqual(p['games'][0]['full'], 0.)
        self.assertEqual(p['returnOutlook']['list'], 'reserve list')

    def test_healthy_and_suspended_players_are_untouched(self):
        p = player()
        monday = datetime(2026, 9, 28, 14, tzinfo=timezone.utc).isoformat()
        self.assertEqual(apply_returns([p], {'p1': 'Sus'}, STATS, SCHEDULE, GAMES, 2026, 4, monday), 0)
        self.assertEqual(p['rosFull'], 60.)


if __name__ == '__main__':
    unittest.main()
