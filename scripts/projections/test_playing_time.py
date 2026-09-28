import unittest

import pandas as pd

from playing_time import flag_games, partial_keys


def frame(rows):
    return pd.DataFrame(rows)


class PlayingTimeRule(unittest.TestCase):
    def setUp(self):
        # Team plays weeks 1-5. Starter plays ~100% weeks 1-3, 10% in week 4.
        self.schedule = frame([dict(season=2026, week=w, team='SEA') for w in range(1, 6)])
        self.stats = frame([dict(season=2026, week=w, player_id='qb', team='SEA') for w in range(1, 5)])
        self.roles = frame([dict(season=2026, week=w, player_id='qb', snap_share=s)
                            for w, s in [(1, 1.), (2, .98), (3, 1.), (4, .1)]])

    def test_cut_short_then_missed_is_partial(self):
        f = flag_games(self.stats, self.roles, self.schedule, set())
        # Week 5 forecast: missing week 5 is not yet known, and no report -> kept.
        self.assertEqual(partial_keys(f, 2026, 5), set())
        # Week 6 forecast: he missed week 5 -> week 4 was cut short.
        self.assertEqual(partial_keys(f, 2026, 6), {(2026, 4, 'qb')})

    def test_injury_report_for_forecast_week_counts(self):
        f = flag_games(self.stats, self.roles, self.schedule, {(2026, 5, 'qb')})
        self.assertEqual(partial_keys(f, 2026, 5), {(2026, 4, 'qb')})

    def test_low_snaps_without_injury_sign_are_a_real_role(self):
        stats = pd.concat([self.stats, frame([dict(season=2026, week=5, player_id='qb', team='SEA')])])
        roles = pd.concat([self.roles, frame([dict(season=2026, week=5, player_id='qb', snap_share=.1)])])
        f = flag_games(stats, roles, self.schedule, set())
        self.assertEqual(partial_keys(f, 2026, 6), set())


if __name__ == '__main__':
    unittest.main()
