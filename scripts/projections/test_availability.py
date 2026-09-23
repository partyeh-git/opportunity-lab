import json
from pathlib import Path
from unittest.mock import patch
import unittest
from copy import deepcopy
import pandas as pd
from availability import apply_availability, load_evidence
from model import STATS, score


def player(identity, position='RB', carries=10., targets=3., attempts=0.):
    s = dict.fromkeys(STATS, 0.)
    s.update(carries=carries, targets=targets, attempts=attempts, rushing_yards=4*carries,
             receptions=.7*targets, receiving_yards=6*targets, completions=.6*attempts,
             passing_yards=7*attempts, passing_tds=.04*attempts)
    games = [dict(week=w, opponent='B', stats=s.copy(), full=score(s), half=score(s,.5), defense={}) for w in (3,4,6)]
    return dict(id=identity, name=identity, position=position, team='A', base=s.copy(), games=games)


def evidence(*records):
    return dict(season=2026, week=3, reviewedAt='2026-09-23T04:00:00+00:00', players=list(records))


def record(identity='out', weeks=None, **extra):
    return dict(id=identity, team='A', outWeeks=[2,3,4] if weeks is None else weeks,
        sources=[dict(kind='official', retrievedAt='2026-09-23T04:00:00+00:00')], **extra)


def history():
    return pd.DataFrame([dict(season=2026, week=w, player_id=p, team='A', carries=c, targets=t)
        for w,p,c,t in [(1,'out',10,3),(1,'backup',5,1),(2,'backup',16,5),(1,'other',4,0),(2,'other',4,0)]])


class AvailabilityTests(unittest.TestCase):
    def test_only_confirmed_weeks_zero_and_input_preserved(self):
        original = [player('out'), player('backup')]
        frozen = deepcopy(original)
        result,_ = apply_availability(original,history(),evidence(record()),2026,3)
        self.assertEqual(original, frozen)
        absent = result[0]
        self.assertTrue(all(v == 0 for v in absent['games'][0]['stats'].values()))
        self.assertEqual(absent['games'][2]['stats'], frozen[0]['games'][2]['stats'])
        self.assertEqual(absent['rosFull'],sum(g['full'] for g in absent['games']))

    def test_uncertain_and_previous_week_out_do_not_zero_current(self):
        for r in [record(weeks=[]), record(weeks=[2])]:
            result,_ = apply_availability([player('out')],history(),evidence(r),2026,3)
            self.assertGreater(result[0]['week']['full'],0)
            self.assertEqual(result[0]['availability']['state'],'uncertain')

    def test_deltas_are_bounded_separate_and_do_not_gift_entire_pool(self):
        result,audit = apply_availability([player('out'),player('backup'),player('other')],history(),evidence(record()),2026,3)
        b = result[1]
        self.assertGreater(b['week']['stats']['carries'],10)
        self.assertLess(b['week']['stats']['carries'],16)
        self.assertEqual(b['week']['stats']['rushing_yards']/b['week']['stats']['carries'],4)
        self.assertEqual(result[2]['roleAdjustments'],[])
        self.assertTrue(any(a['unallocated'] > 0 for a in audit))
        for a in audit:
            self.assertLessEqual(a['allocated'],a['vacated'])
        self.assertEqual(b['games'][2]['stats']['carries'],10)

    def test_already_priced_role_has_no_double_increase(self):
        result,_ = apply_availability([player('out'),player('backup',carries=20,targets=8)],history(),evidence(record()),2026,3)
        self.assertEqual(result[1]['roleAdjustments'],[])

    def test_multiple_donors_still_respect_one_recipient_cap(self):
        result,audit = apply_availability([player('out'),player('out2'),player('backup')],history(),evidence(record(),record('out2')),2026,3)
        self.assertLessEqual(result[2]['week']['stats']['carries'],16)
        self.assertEqual(len([a for a in audit if a['week']==3 and a['opportunity']=='carries']),1)

    def test_future_usage_cannot_affect_role_evidence(self):
        h = history()
        future = h.copy(); future['week']=3; future['carries']=9999; future['targets']=9999
        args = ([player('out'),player('backup')],evidence(record()))
        a = apply_availability(args[0],h,args[1],2026,3)
        b = apply_availability(args[0],pd.concat([h,future]),args[1],2026,3)
        self.assertEqual(a,b)

    def test_uncertain_recipient_not_boosted(self):
        result,_ = apply_availability([player('out'),player('backup')],history(),evidence(record(),record('backup',weeks=[])),2026,3)
        self.assertEqual(result[1]['roleAdjustments'],[])

    def test_new_absence_without_role_observations_not_redistributed(self):
        result,audit = apply_availability([player('out'),player('backup')],history(),evidence(record(weeks=[3])),2026,3)
        self.assertEqual(result[1]['roleAdjustments'],[])
        self.assertTrue(all(a['allocated']==0 for a in audit))

    def test_missing_usage_during_absence_is_zero_not_dropped(self):
        h=history(); h=h[~(h.player_id.eq('backup') & h.week.eq(2))]
        result,_=apply_availability([player('out'),player('backup')],h,evidence(record()),2026,3)
        self.assertEqual(result[1]['roleAdjustments'],[])

    def test_named_qb_uses_own_passing_rates_no_rushing_transfer(self):
        original=[player('out','QB',carries=8,targets=0,attempts=25),player('backup','QB',carries=2,targets=0,attempts=5)]
        r=record(weeks=[3],replacementId='backup',replacementWeeks=[3])
        result,_=apply_availability(original,history(),evidence(r),2026,3)
        b=result[1]['week']['stats']
        self.assertEqual(b['attempts'],30)
        self.assertEqual(b['passing_yards'],210)
        self.assertEqual(b['carries'],2)
        self.assertEqual(result[1]['games'][1]['stats']['attempts'],5)

    def test_stale_future_wrong_week_and_unsourced_evidence_rejected(self):
        with patch('availability.Path.read_text') as read:
            path=Path('evidence.json')
            good=evidence(record())
            for changed,as_of in [(good,'2026-09-26T04:00:00+00:00'),(good,'2026-09-22T04:00:00+00:00'),
                                  ({**good,'week':2},'2026-09-23T04:00:00+00:00'),
                                  (evidence({**record(),'sources':[]}), '2026-09-23T04:00:00+00:00')]:
                read.return_value=json.dumps(changed)
                with self.assertRaises(ValueError):
                    load_evidence(path,2026,3,as_of)
            read.return_value=json.dumps(good)
            self.assertEqual(load_evidence(path,2026,3,'2026-09-23T04:00:00+00:00'),good)


if __name__=='__main__':
    unittest.main()
