import unittest
from datetime import datetime, timezone
import pandas as pd
from returns import RATES, apply_returns
from timelines import games_out, read_note, sentences

OTHERS = {'Bagent', 'Brown', 'Goedert', 'Daniels', 'Mason'}


def note(title='', description='', analysis=''):
    return dict(published=0, metadata=dict(title=title, description=description, analysis=analysis))


def read(name, **text):
    return read_note(note(**text), name, OTHERS - {name.split()[-1]}, 2026)


class ReadingTest(unittest.TestCase):
    def test_a_range_in_the_body_beats_a_vague_title(self):
        t = read('Caleb Williams', title='Caleb Williams - May miss multiple games with Grade 2 strain',
                 description='Williams has been diagnosed with a Grade 2 hamstring strain, which doctors consider '
                             'a 3-to-4-week injury, a report says.')
        self.assertEqual((t['kind'], t['shortest'], t['longest']), ('week', 3, 4))

    def test_lengths(self):
        for text, expected in [
            ('Player Name (thumb) expected to miss three weeks', ('week', 3, 3)),
            ('He will miss "a minimum of three weeks" with a dislocated thumb.', ('week', 3, None)),
            ('He will now miss at least the next four games.', ('game', 4, None)),
            ('He is expected to be sidelined for a few weeks.', ('week', 3, None)),
            ('They are hopeful he will only miss about one month.', ('week', 4, 4)),
            ('Player Name - Expected back within three weeks', ('week', 2, 3)),
        ]:
            t = read('Player Name', title=text) if text.startswith('Player') else read('Player Name', description=text)
            self.assertEqual((t['kind'], t['shortest'], t['longest']), expected, text)

    def test_season_ending(self):
        self.assertEqual(read('De\'Von Achane', title="De'Von Achane (knee) suffers season-ending torn ACL")['kind'], 'season')
        self.assertIsNone(read('C.J. Stroud', description='After a season-ending playoff loss, Stroud protected the ball.'))
        self.assertIsNone(read('Tucker Kraft', description='Kraft suffered a season-ending ACL tear in 2025 but is good to go.'))

    def test_teammates_the_past_and_what_ifs_are_not_read(self):
        for name, text in [
            ('Aaron Jones', 'With Mason out for at least another three games, Jones is in line for more touches.'),
            ('Johnny Mundt', 'Goedert is now slated to miss multiple weeks due to the injury.'),
            ('Drake Maye', 'A.J. Brown (ankle), who is expected to miss six weeks, did not practice.'),
            ('Zay Flowers', 'Flowers led the team in catches in his return following a one-game absence.'),
            ('Alvin Kamara', 'Kamara was diagnosed with a sprain that was expected to sideline him for one month.'),
            ('Travis Etienne', 'The Saints are unsure if he will go on injured reserve, which would require him to miss four games.'),
            ('Brian Thomas', 'Thomas looks to bounce back in a Week 4 matchup with the Bengals.'),
        ]:
            self.assertIsNone(read(name, description=text), text)

    def test_initials_do_not_split_sentences(self):
        self.assertEqual(len(sentences('A.J. Brown is out. He will miss time on Nov. 1 too.')), 2)


def kick(month, day):
    return datetime(2026, month, day, 17, tzinfo=timezone.utc)


KICKS = {2: kick(9, 20), 3: kick(9, 28), 4: kick(10, 4), 5: kick(10, 11), 6: kick(10, 18), 7: kick(10, 22)}
REPORT = datetime(2026, 9, 27, 12, tzinfo=timezone.utc).isoformat()


class GamesOutTest(unittest.TestCase):
    def test_weeks_run_from_the_game_he_was_hurt_in(self):
        t = dict(kind='week', shortest=3, longest=4, published=REPORT)
        # Hurt 9/20: three weeks is 10/11, so only Week 4 is inside the timeline.
        self.assertEqual(games_out(t, [4, 5, 6, 7], KICKS, {1, 2}), 1)
        self.assertEqual(games_out(dict(t, shortest=4), [4, 5, 6, 7], KICKS, {1, 2}), 2)

    def test_games_count_from_the_report(self):
        t = dict(kind='game', shortest=4, longest=None, published=REPORT)
        self.assertEqual(games_out(t, [4, 5, 6, 7], KICKS, {1, 2}), 3)  # Weeks 3 to 6

    def test_season(self):
        self.assertEqual(games_out(dict(kind='season', published=REPORT), [4, 5, 6, 7], KICKS, {1, 2}), 4)

    def test_over_once_he_plays_or_the_time_has_passed(self):
        t = dict(kind='week', shortest=1, longest=1, published=datetime(2026, 9, 15, tzinfo=timezone.utc).isoformat())
        self.assertIsNone(games_out(t, [4, 5], KICKS, {1}))
        t = dict(kind='week', shortest=6, longest=8, published=datetime(2026, 9, 15, tzinfo=timezone.utc).isoformat())
        self.assertIsNone(games_out(t, [4, 5], KICKS, {1, 3}))


def player(pid='p1', team='CHI', weeks=(4, 5, 6, 7)):
    games = [dict(week=w, opponent='X', stats=dict(passingYards=200.), full=20., half=20.) for w in weeks]
    return dict(id=pid, team=team, games=games, week=games[0], rosFull=80., rosHalf=80.)


GAMES = pd.DataFrame([dict(season=2026, game_type='REG', week=w, gameday=k.date().isoformat(), gametime='13:00',
                           home_team='CHI', away_team='X') for w, k in KICKS.items()])
SCHEDULE = pd.DataFrame([dict(season=2026, week=w, team='CHI') for w in range(1, 8)])
STATS = pd.DataFrame([dict(season=2026, week=w, player_id='p1') for w in (1, 2)])
TUESDAY = datetime(2026, 9, 29, 14, tzinfo=timezone.utc).isoformat()
TIMELINE = dict(p1=dict(kind='week', shortest=3, longest=4, published=REPORT, source='rotowire', text='a 3-to-4-week injury'))


class OverrideTest(unittest.TestCase):
    def test_timeline_rules_him_out_then_the_return_curve_starts(self):
        p = player()
        apply_returns([p], {'p1': 'Out'}, STATS, SCHEDULE, GAMES, 2026, 4, TUESDAY, TIMELINE)
        curve = RATES['curves']['Out|0']['relative']
        self.assertEqual([g['returnChance'] for g in p['games']], [0., curve[0], curve[1], curve[2]])
        self.assertEqual(p['returnOutlook']['timeline']['outThroughWeek'], 4)

    def test_timeline_applies_before_any_injury_status_is_posted(self):
        p = player()
        self.assertEqual(apply_returns([p], {}, STATS, SCHEDULE, GAMES, 2026, 4, TUESDAY, TIMELINE), 1)
        self.assertEqual(p['games'][0]['full'], 0.)
        self.assertEqual(p['returnOutlook']['list'], 'reported timeline')

    def test_timeline_never_raises_a_chance(self):
        p, q = player(), player()
        apply_returns([p], {'p1': 'IR'}, STATS, SCHEDULE, GAMES, 2026, 4, TUESDAY, TIMELINE)
        apply_returns([q], {'p1': 'IR'}, STATS, SCHEDULE, GAMES, 2026, 4, TUESDAY)
        for a, b in zip(p['games'], q['games']):
            self.assertLessEqual(a['returnChance'], b['returnChance'])

    def test_cleared_on_the_final_report_ends_the_timeline(self):
        p = player()
        saturday = datetime(2026, 10, 3, 14, tzinfo=timezone.utc).isoformat()
        self.assertEqual(apply_returns([p], {'p1': 'Questionable'}, STATS, SCHEDULE, GAMES, 2026, 4, saturday, TIMELINE), 0)
        self.assertEqual(p['rosFull'], 80.)


if __name__ == '__main__':
    unittest.main()
