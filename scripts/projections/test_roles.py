import unittest

import pandas as pd

from roles import blend, role_inputs


def frames():
    stats = pd.DataFrame([
        dict(season=2026, week=1, player_id='a', position='WR', team='SEA', targets=10, carries=0),
        dict(season=2026, week=2, player_id='a', position='WR', team='SEA', targets=6, carries=0),
        dict(season=2026, week=4, player_id='a', position='WR', team='SEA', targets=20, carries=0),  # after cutoff
    ])
    roles = pd.DataFrame([
        dict(season=2026, week=1, game_id='g1', team='SEA', player_id='a', snaps=50, snap_share=.8, team_plays=62.5),
        dict(season=2026, week=2, game_id='g2', team='SEA', player_id='a', snaps=30, snap_share=.5, team_plays=60.),
        dict(season=2026, week=4, game_id='g4', team='SEA', player_id='a', snaps=70, snap_share=1., team_plays=70.),
    ])
    return stats, roles


class RoleInputs(unittest.TestCase):
    def test_uses_only_games_before_cutoff(self):
        stats, roles = frames()
        info = role_inputs(stats, roles, 2026, 3, {'WR targets': .2, 'WR carries': 0.}, pseudo_snaps=0)['a']
        self.assertAlmostEqual(info['targets']['last2'], 8.)
        self.assertAlmostEqual(info['snapShareLast2'], .65)
        # snap share x team plays x targets per snap (16 targets / 80 snaps), same units throughout.
        self.assertAlmostEqual(info['targets']['role'], .65 * 61.25 * .2)

    def test_missed_games_are_skipped_not_zero(self):
        stats, roles = frames()
        stats = stats[stats.week.ne(1)]
        roles = roles[roles.week.ne(1)]
        info = role_inputs(stats, roles, 2026, 4, {'WR targets': .2, 'WR carries': 0.}, pseudo_snaps=0)['a']
        self.assertAlmostEqual(info['targets']['last2'], 6.)

    def test_shrinks_rate_toward_position(self):
        stats, roles = frames()
        info = role_inputs(stats, roles, 2026, 3, {'WR targets': .1, 'WR carries': 0.}, pseudo_snaps=80)['a']
        self.assertAlmostEqual(info['targets']['role'], .65 * 61.25 * ((16 + 8) / 160))

    def test_blend_is_non_negative(self):
        self.assertEqual(blend(0., {'last2': 0., 'role': -5.}, [.4, 0., .6]), 0.)
        self.assertAlmostEqual(blend(10., {'last2': 8., 'role': 5.}, [.4, .1, .5]), 7.3)


if __name__ == '__main__':
    unittest.main()
