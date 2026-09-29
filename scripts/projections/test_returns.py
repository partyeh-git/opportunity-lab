import unittest
from datetime import datetime, timezone
import pandas as pd
from returns import RATES, apply_returns, chances_list, chances_out, games_missed, games_served


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
        for served in range(9):
            odds = chances_list(served, 10)
            self.assertEqual(odds, sorted(odds))
            self.assertTrue(all(0 <= x < 1 for x in odds))

    def test_list_players_miss_four_games_before_any_chance(self):
        first = RATES['lists']['inside']['played'][0]
        just_placed = chances_list(0, 6)
        self.assertEqual(just_placed[:4], [0.]*4)
        self.assertAlmostEqual(just_placed[4], first/RATES['healthy'][3])
        self.assertEqual(chances_list(3, 3)[0], 0.)
        self.assertAlmostEqual(chances_list(3, 3)[1], first/RATES['healthy'][0])
        # Tuesday build: listed for his last game, which was his third on the list.
        self.assertEqual(chances_list(3, 3, fresh=False)[:2], [0., chances_list(2, 3)[2]])
        # Placed on the list since his last game: he has served none and misses this one.
        self.assertEqual(chances_list(0, 5, fresh=False), chances_list(0, 5))

    def test_still_listed_after_he_could_return_comes_back_slower(self):
        self.assertLess(chances_list(7, 4)[1], chances_list(4, 4)[1])
        self.assertLess(chances_list(4, 4)[1], chances_list(3, 4)[1])

    def test_games_served_counts_listed_games_in_a_row(self):
        listed = {(2, 'p1'), (3, 'p1'), (3, 'p2')}
        self.assertEqual(games_served(listed, SCHEDULE, 2026, 4, 'p1', 'CHI'), 2)
        self.assertEqual(games_served(listed, SCHEDULE, 2026, 4, 'p3', 'CHI'), 0)
        self.assertIsNone(games_served({(2, 'p1')}, SCHEDULE, 2026, 4, 'p1', 'CHI'))  # rosters stop at Week 2
        self.assertIsNone(games_served(None, SCHEDULE, 2026, 4, 'p1', 'CHI'))

    def test_stale_status_starts_one_game_later(self):
        curve = RATES['curves']['Out|0']['relative']
        self.assertEqual(chances_out(0, 3, fresh=False), curve[:3])
        self.assertEqual(chances_out(0, 3, fresh=True), [0., curve[0], curve[1]])

    def test_games_missed_counts_back_from_the_target_week(self):
        self.assertEqual(games_missed(STATS, SCHEDULE, 2026, 4, 'p1', 'CHI'), 1)

    def test_fade_scales_future_games_but_not_this_weeks_if_active_line(self):
        p = player()
        monday = datetime(2026, 9, 28, 14, tzinfo=timezone.utc).isoformat()
        n = apply_returns([p], {'p1': 'Out'}, STATS, SCHEDULE, GAMES, 2026, 4, monday)
        # Ruled out for Week 3, his first game missed: the row is 'none missed before it'.
        curve = RATES['curves']['Out|0']['relative']
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

    def test_early_build_pending_team_is_not_shifted(self):
        # Monday: CHI's Week 3 game is still to be played and is not in the schedule.
        p, schedule = player(), SCHEDULE[SCHEDULE.week.ne(3)]
        monday = datetime(2026, 9, 28, 14, tzinfo=timezone.utc).isoformat()
        apply_returns([p], {'p1': 'Out'}, STATS, schedule, GAMES, 2026, 4, monday, pending_teams=['CHI'])
        self.assertAlmostEqual(p['games'][0]['returnChance'], RATES['curves']['Out|0']['relative'][0])

    def test_healthy_and_suspended_players_are_untouched(self):
        p = player()
        monday = datetime(2026, 9, 28, 14, tzinfo=timezone.utc).isoformat()
        self.assertEqual(apply_returns([p], {'p1': 'Sus'}, STATS, SCHEDULE, GAMES, 2026, 4, monday), 0)
        self.assertEqual(p['rosFull'], 60.)


if __name__ == '__main__':
    unittest.main()
