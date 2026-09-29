"""Reported recovery timelines, read from the archived player notes (public/notes/<sleeperId>.json).

The return fade (returns.py) uses league-wide averages. When a report gives a specific player's
timeline ("a 3-to-4-week injury", "will miss at least six weeks", "out for the season"), that
timeline replaces the average: he counts as out until the short end of the range has passed, then
fades back in on the usual return curve. Only notes published before the build's cutoff are read
(no hindsight), only sentences about the note's own player, and a timeline ends once he plays.
timeline-overrides.json corrects or silences a misread note by hand.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

WORDS = dict(one=1, two=2, three=3, four=4, five=5, six=6, seven=7, eight=8, nine=9, ten=10,
             eleven=11, twelve=12, a=1)
# Vague lengths are read at their short end: he is ruled out for that long, then fades back in.
VAGUE = {'a couple': 2, 'a couple of': 2, 'a few': 3, 'few': 3, 'several': 3, 'multiple': 2}
NUM = r'(?:\d{1,2}|' + '|'.join(k for k in WORDS if k != 'a') + r')'
SPAN = rf'(?P<lo>{NUM})(?:\s*-?\s*(?:to|or|-|–)\s*-?\s*(?P<hi>{NUM}))?'
LENGTH = rf'(?:(?P<vague>a couple(?: of)?|a few|several|multiple)|(?P<one>a|one)(?=[\s-]+(?:week|month))|{SPAN})(?P<plus>-plus|\+)?'
UNIT = r'[\s-]*(?P<unit>week|month|game)s?\b(?!\s*\d)'
HEDGE = r'(?:(?:at least|a minimum of|about|around|roughly|approximately|up to|the next|the first|another|an additional|"a minimum of)\s+)*'
AHEAD = r'(?:expected to|likely to|set to|slated to|going to|will|would|could|to|and|should|may|might)\s+(?:likely\s+|now\s+|still\s+|only\s+)?'
PATTERNS = [
    # "expected to miss three to four weeks", "will be sidelined for at least the next four games"
    re.compile(rf'\b(?:{AHEAD}miss|{AHEAD}be (?:out|sidelined|shelved|sidelined for|unavailable)|{AHEAD}sit out|'
               rf'sidelines? him|keeps? him out|be without (?:him|\w+)|out|sidelined)\s+(?:for\s+|of action for\s+)?'
               rf'(?:"?{HEDGE}){LENGTH}{UNIT}', re.I),
    # "a 3-to-4-week injury", "four-to-six-week absence", "recovery timeline of six weeks"
    re.compile(rf'\b{LENGTH}{UNIT}[\s-]*(?:injury|absence|recovery|timeline|timetable|range)', re.I),
    re.compile(rf'\b(?:timeline|timetable|recovery)\b[^.]{{0,40}}?\b(?:of|is|at|be|around)\s+{HEDGE}{LENGTH}{UNIT}', re.I),
    # "hoping to return in roughly four to six weeks"
    re.compile(rf'\b(?:return|back)\s+(?:to action\s+|to the field\s+)?(?:in|within)\s+{HEDGE}{LENGTH}{UNIT}', re.I),
]
SEASON = re.compile(r'\b(?:out for the (?:year|season|rest of the (?:year|season)|remainder of the (?:year|season))|'
                    r'season-ending(?! (?:playoff|loss|defeat|game|finale|win))|miss the (?:rest|remainder) of the (?:\d{4} )?(?:year|season|campaign)|'
                    r'miss the entire (?:\d{4} )?(?:year|season|campaign)|'
                    r'(?:his|the) (?:\d{4} )?season is over|done for the (?:year|season))\b', re.I)
# Not a forecast of this player's absence: the past, a what-if, or a denial.
PAST = re.compile(r"\b(?:missed|after missing|missing the (?:last|past)|was (?:sidelined|expected|diagnosed)|"
                  r"were expected|had (?:his|been|missed)|kept him out|last (?:season|year|december|november|october)|"
                  r"in 20\d\d|20\d\d (?:season|campaign)|returned|returns?\b(?! in| within)|return (?:from|following)|"
                  r"(?:his|in his|the) return|after being|following an?|during|initial reports|originally|"
                  r"avoid(?:ed|s)?|not expected to miss|won't miss|will not miss|no (?:firm )?timetable|"
                  r"to be determined|unsure|which would|would require|would (?:miss|be)|whether|if he|unless|"
                  r"not season-ending|isn't season-ending|fear(?:ed|s)?|dodged|good to go|off the [\w' ]*injury report)\b", re.I)
OTHER = re.compile(r"([A-Z][\w'.-]+(?: (?:[A-Z][\w'.-]+|III|II|IV|Jr\.|Sr\.))+)\s*\(")
SUBJECT = re.compile(r'\b(?:he|him|his|he\'ll|he\'s)\b', re.I)
ABBREVIATION = re.compile(r"(?:\b[A-Z]|\b(?:Jr|Sr|St|vs|No|Jan|Feb|Aug|Sept?|Oct|Nov|Dec))\.$")
# Last names that also open ordinary sentences.
COMMON = {'With', 'Both', 'Still', 'More', 'Even', 'Given', 'Little', 'Head', 'Love', 'Short', 'Long', 'Early', 'Best',
          'Good', 'Young', 'Green', 'White', 'Brown', 'Black', 'Rice', 'Hand', 'Strong', 'Sample', 'Means', 'Will'}
SUFFIX = ('Jr.', 'Sr.', 'II', 'III', 'IV', 'V')
MONTH_WEEKS = 4


def sentences(text):
    out, current = [], ''
    for part in re.split(r'(?<=[.!?])\s+', text):
        current = f'{current} {part}'.strip()
        if not ABBREVIATION.search(part):
            out.append(current)
            current = ''
    return out + ([current] if current else [])


def last_name(name):
    parts = [x for x in name.split() if x not in SUFFIX]
    return parts[-1]


def number(text):
    text = text.lower()
    return int(text) if text.isdigit() else WORDS[text]


def length(m):
    """(shortest, longest or None, unit) of a matched length; months become weeks."""
    lead = m.group(0).lower()
    if m.group('vague'):
        lo, hi = VAGUE[re.sub(r'\s+', ' ', m.group('vague').lower())], None
    elif m.group('one'):
        lo = hi = 1
    else:
        lo = number(m.group('lo'))
        hi = number(m.group('hi')) if m.group('hi') else lo
    unit = m.group('unit').lower()
    if unit == 'month':
        lo, hi, unit = lo*MONTH_WEEKS, hi and hi*MONTH_WEEKS, 'week'
    if m.group('plus') or re.search(r'at least|minimum|another|additional', lead):
        hi = None
    elif re.search(r'within|up to', lead) and lo == hi:
        lo = max(1, lo-1)  # "back within three weeks" is the long end, not the short end
    return lo, hi, unit


def about_player(text, start, name, others, title=False):
    """The sentence must be about the note's own player: nobody else is named before the match,
    and the player (by name, or 'he' in the body) is its subject."""
    own = last_name(name)
    head = text[:start]
    for m in re.finditer(r"[A-Z][\w'-]+", head):
        word = re.sub(r"'s$", '', m.group(0))
        if word != own and word in others and not (m.start() == 0 and word in COMMON):
            return False
    for m in OTHER.finditer(text):
        if own not in m.group(1).split():
            return False
    return title or own in text or bool(SUBJECT.search(text))


def read_note(note, name, others, season):
    """The timeline a note reports for its own player, or None. The most specific statement wins:
    a season-ending injury, then a range in weeks or games, then a vague length."""
    meta = note.get('metadata') or {}
    title = (meta.get('title') or '').strip()
    body = ' '.join(filter(None, [meta.get('description'), meta.get('analysis')]))
    found = []
    for place, text in [('title', title)] + [('body', s) for s in sentences(body)]:
        if PAST.search(text) or str(season-1) in text:
            continue
        m = SEASON.search(text)
        if m and not re.search(r"\b(?:not|isn't|could|may|might|possibly|potentially)\b", text, re.I) \
                and about_player(text, m.start(), name, others, place == 'title'):
            return dict(kind='season', text=text.strip()[:300])
        for pattern in PATTERNS:
            m = pattern.search(text)
            if not m or not about_player(text, m.start(), name, others, place == 'title'):
                continue
            lo, hi, unit = length(m)
            if lo <= 17:
                found.append(dict(kind=unit, shortest=lo, longest=hi, vague=bool(m.group('vague')),
                                  text=text.strip()[:300]))
            break
    found.sort(key=lambda t: (t['vague'], t['kind'] != 'week', -t['shortest']))
    return found[0] if found else None


def other_names(sleeper):
    """Last names of skill players on a roster; a sentence naming one is about him."""
    return {last_name(v['full_name']) for v in sleeper.values()
            if v.get('full_name') and v.get('team') and v.get('position') in ('QB', 'RB', 'WR', 'TE')}


def read_timelines(notes_dir, sleeper, ids, season, as_of, since_days=75, cluster_days=3):
    """Latest reported timeline per player. ids: sleeperId -> our player id. Reports within a few
    days of the newest one are read together and the most specific statement is kept."""
    cutoff = datetime.fromisoformat(as_of)
    oldest = cutoff - timedelta(days=since_days)
    others, out = other_names(sleeper), {}
    for sid, pid in ids.items():
        path = Path(notes_dir)/f'{sid}.json'
        name = (sleeper.get(sid) or {}).get('full_name')
        if not path.exists() or not name:
            continue
        found = []
        for note in json.loads(path.read_text(encoding='utf-8')):
            when = datetime.fromtimestamp(note['published']/1000, tz=timezone.utc)
            if oldest <= when <= cutoff:
                t = read_note(note, name, others - {last_name(name)}, season)
                if t:
                    found.append(dict(t, name=name, published=when.isoformat(), source=note.get('source', ''),
                                      url=(note.get('metadata') or {}).get('url', '')))
        if not found:
            continue
        newest = max(t['published'] for t in found)
        near = [t for t in found if datetime.fromisoformat(newest)-datetime.fromisoformat(t['published'])
                <= timedelta(days=cluster_days)]
        near.sort(key=lambda t: (t['kind'] != 'season', t.get('vague', False), t['kind'] != 'week', t['published']),
                  reverse=False)
        # Among equally specific statements the newest report wins.
        best = [t for t in near if (t['kind'], t.get('vague')) == (near[0]['kind'], near[0].get('vague'))]
        out[pid] = max(best, key=lambda t: t['published'])
    return out


def with_overrides(timelines, path):
    """Hand corrections: {"players": {id: {"ignore": true}}} silences a misread note;
    {id: {"kind": "week", "shortest": 3, "longest": 4, "published": ISO time, "text": why}} sets one."""
    path = Path(path)
    if not path.exists():
        return timelines
    out = dict(timelines)
    for pid, fix in json.loads(path.read_text(encoding='utf-8')).get('players', {}).items():
        if fix.get('ignore'):
            out.pop(pid, None)
        else:
            out[pid] = dict(fix, source='manual')
    return out


def games_out(timeline, weeks, kicks, played, injury_window_days=10):
    """How many of his upcoming games (weeks, in order) the timeline rules out; None when the
    timeline is over: he has played since the report, or his next game falls after it.

    kicks: week -> kickoff time of his team's game; played: weeks he has played this season.
    A length in weeks runs from the game he was hurt in (his last game, when the report came
    within days of it), otherwise from the report. He is out for games before the short end.
    """
    published = datetime.fromisoformat(timeline['published'])
    if any(kicks.get(w) and kicks[w] > published for w in played) or not weeks:
        return None
    if timeline['kind'] == 'season':
        return len(weeks)
    if timeline['kind'] == 'game':
        ahead = sorted(w for w, k in kicks.items() if k > published)[:timeline['shortest']]
        out = sum(w in ahead for w in weeks)
    else:
        last = max((kicks[w] for w in played if w in kicks), default=None)
        start = last if last and published-last <= timedelta(days=injury_window_days) else published
        back = (start + timedelta(weeks=timeline['shortest'])).date()
        out = sum(kicks[w].date() < back for w in weeks if w in kicks)
    return out or None
