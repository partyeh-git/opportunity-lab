import unittest
from copy import deepcopy
import pandas as pd
from model import STATS, CONFIG, score, apply_matchup, forecast


def inputs():
    rows=[];fixtures=[]
    for season in (2025,2026):
        for week in range(1,7):
            game=f'{season}_{week}_A_B'
            for team,opponent in [('A','B'),('B','A')]:
                fixtures.append(dict(season=season,week=week,game_id=game,team=team,opponent=opponent))
                if season==2026 and week>2:continue
                for pos in ('QB','RB','WR','TE'):
                    s=dict.fromkeys(STATS,0.)
                    if pos=='QB':s.update(attempts=35,passing_yards=245,passing_tds=2,passing_interceptions=1,carries=4,rushing_yards=24)
                    if pos=='RB':s.update(carries=10 if season==2025 else 25,rushing_yards=50 if season==2025 else 125,targets=2 if season==2025 else 8,receptions=2 if season==2025 else 6,receiving_yards=15 if season==2025 else 45)
                    if pos=='WR':s.update(targets=12,receptions=8,receiving_yards=90,receiving_tds=.5)
                    if pos=='TE':s.update(targets=5,receptions=3,receiving_yards=30)
                    rows.append(dict(season=season,week=week,game_id=game,team=team,opponent_team=opponent,
                        position=pos,player_id=team+pos,player_display_name=team+pos,**s))
    return pd.DataFrame(rows),pd.DataFrame(fixtures)


class ProjectionTests(unittest.TestCase):
    def test_two_games_do_not_fully_replace_prior(self):
        stats,schedule=inputs()
        p=next(p for p in forecast(stats,schedule,2026,3) if p['id']=='ARB')
        self.assertLess(p['base']['carries'],25)
        self.assertLess(p['base']['targets'],8)
        self.assertGreater(p['base']['carries'],10)
        self.assertLess(p['workloadEvidence']['recentWeight'],1)

    def test_future_stats_and_identities_cannot_change_forecast(self):
        stats,schedule=inputs()
        before=forecast(stats,schedule,2026,3)
        future=stats[stats.season.eq(2026)].copy()
        future['week']=5;future['player_display_name']='Future';future['player_id']='unknown'
        future[STATS]=99999
        after=forecast(pd.concat([stats,future],ignore_index=True),schedule,2026,3)
        self.assertEqual(before,after)

    def test_rb_receiving_does_not_change_rb_rushing_or_wr(self):
        base=dict.fromkeys(STATS,0.);base.update(carries=20,rushing_yards=80,targets=5,receptions=4,receiving_yards=40)
        defense={('B','RB','receiving'):dict(factor=1.2,weightedOpportunities=100,reliability=.5)}
        rb,_=apply_matchup(base,'B','RB',defense)
        wr,_=apply_matchup(base,'B','WR',defense)
        self.assertEqual(rb['rushing_yards'],80)
        self.assertEqual(rb['receiving_yards'],48)
        self.assertEqual(wr['receiving_yards'],40)

    def test_qb_rushing_and_passing_are_independent(self):
        base=dict.fromkeys(STATS,0.);base.update(attempts=30,passing_yards=250,carries=5,rushing_yards=40)
        d={('B','QB','rushing'):dict(factor=.8,weightedOpportunities=100,reliability=.5)}
        p,_=apply_matchup(base,'B','QB',d)
        self.assertEqual(p['passing_yards'],250)
        self.assertEqual(p['rushing_yards'],32)

    def test_sparse_or_unknown_defense_defaults_to_neutral(self):
        base=dict.fromkeys(STATS,0.);base.update(carries=10,rushing_yards=40)
        p,f=apply_matchup(base,'UNKNOWN','RB',{})
        self.assertEqual(p,base)
        self.assertTrue(all(x['reliability']==0 for x in f.values()))

    def test_ros_sums_scheduled_games_and_handles_bye(self):
        stats,schedule=inputs()
        schedule=schedule[~(schedule.season.eq(2026)&schedule.week.eq(4))]
        ps=forecast(stats,schedule,2026,3)
        for p in ps:
            self.assertEqual(p['remainingGames'],3)
            self.assertEqual(p['rosFull'],sum(g['full'] for g in p['games']))
            self.assertNotIn(4,[g['week'] for g in p['games']])

    def test_future_opponent_changes_ros_but_not_this_week(self):
        stats,schedule=inputs()
        a=forecast(stats,schedule,2026,3)
        changed=schedule.copy()
        changed.loc[changed.season.eq(2026)&changed.week.ge(4),'opponent']='UNKNOWN'
        b=forecast(stats,changed,2026,3)
        for pa,pb in zip(a,b):self.assertEqual(pa['week'],pb['week'])
        self.assertTrue(any(abs(pa['rosFull']-pb['rosFull'])>.001 for pa,pb in zip(a,b)))

    def test_scoring_and_bounds(self):
        stats,schedule=inputs()
        for p in forecast(stats,schedule,2026,3):
            for g in p['games']:
                s=g['stats']
                self.assertAlmostEqual(g['full']-g['half'],.5*s['receptions'])
                self.assertLessEqual(s['receptions'],s['targets'])
                self.assertTrue(all(.8<=f['factor']<=1.2 for f in g['defense'].values()))


if __name__=='__main__':unittest.main()
