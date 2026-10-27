'''
build the data files for the static site (docs/) from the collected metadata in the data folder two levels up

1. papers per journal      journal_store/ (HeinOnline table-of-contents metadata; see journal_store.py)
2. faculty per school      faculty_runs/ (HeinOnline's faculty lists by school), older authors_latest.csv
3. journal ranks           newest rankings_<year>.csv (Washington & Lee): specialty journals
4. US law school list      newest usnews_<edition>.csv (U.S. News, via TaxProf Blog), else the hand-saved
                           2025_USnews.txt, plus the ABA-approved list aba_schools_<year>.csv, checked against the
                           faculty lists; also ranks the flagship law reviews (each school's main review gets its school's rank)
5. flagship -> school      flagship_schools.csv in the data folder: which school publishes each W&L General journal

python build_data.py              # rebuild docs/data/*.json
python build_data.py --publish    # rebuild, then git commit + push docs/ (site updates on GitHub Pages)
python build_data.py --site-version   # only the pages, scripts or styles changed: new patch number, data untouched
'''

import argparse
import glob
import hashlib
import json
import os
import re
import io
import subprocess
import time
import unicodedata
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime
from urllib.parse import urlparse, parse_qs, unquote, quote

import sys

import pandas as pd
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(HERE, 'docs', 'data')

sys.path.insert(0, SOURCE_DIR)
import journal_store as js   # noqa: E402  (shared volume keys, years and author keys with the collection code)
js.STORE_DIR = os.path.join(SOURCE_DIR, 'journal_store')
import hein_profiles as hp   # noqa: E402  (HeinOnline's own name forms per faculty member, from its author profiles)
FACULTY_PRIORITY = os.path.join(SOURCE_DIR, 'faculty_runs', 'priority.txt')   # schools whose metadata is updated first
SCHOOL_CSVS = os.path.join(SOURCE_DIR, 'faculty_runs', '*.csv_metric')      # HeinOnline's per-school faculty CSVs, older layout
SCHOOL_CSV_DIR = os.path.join(SOURCE_DIR, 'faculty_runs', 'school_csv')       # ... and the current one
MISSING_HOMEPAGES = os.path.join(SOURCE_DIR, 'faculty_runs', 'missing_homepages.csv')
INFERRED_HOMEPAGES = os.path.join(SOURCE_DIR, 'faculty_runs', 'inferred_homepages.csv')   # found on the schools' own sites

# Versions (2026-10-24, the owner's rule): MAJOR.minor.patch, shown as "Volume 2.1.0".
#   major: set here by hand for a major update (minor and patch go back to 0)
#   minor: goes up when the substantive data changes (papers, authors, credits, schools, journals: a hash of
#          data.json and the titles); the "data updated" timestamp on the site is the time of that change
#   patch: goes up when anything else the site serves changes (its pages, scripts, styles), data unchanged
MAJOR = 2
SITE_FILES = ['docs/*.html', 'docs/*.js', 'docs/*.css']

# Faculty corrections anyone can propose with a GitHub pull request (faculty/README.md says how); applied on top of
# Hein's faculty lists in every build. The full list the build used is written to faculty/list-<letter>.csv.
FACULTY_EDITS = os.path.join(HERE, 'faculty', 'edits.csv')
FACULTY_LIST_DIR = os.path.join(HERE, 'faculty')

# Flagship law reviews (W&L's General category) are ranked by the US News rank of the school that publishes
# them; specialty journals by their W&L rank. This file says which school publishes each General journal and
# whether it is that school's main law review ("main"), an online edition ("online"), a second general journal
# ("secondary"), or not a school's journal ("non_school", "foreign"). Only main reviews get a US News rank.
FLAGSHIP_FILE = os.path.join(SOURCE_DIR, 'flagship_schools.csv')
# 2026-10-25 (the owner: "Re-place every specialty journal by its own scope statement and W&L subject only, with no
# title data"): specialty journal -> area > field, each placed by two independent placers from the journal's own scope
# statement and its W&L subjects (a third decided the 6 they split on); the basis, the deciding words and the scope
# statement are in the file. Journals whose scope is law or policy generally sit in "General & Policy Journals" with
# weight 0 (no area for anyone). The earlier table (journal_taxonomy.csv) used the faculty papers' titles; not read now.
TAXONOMY_FILE = os.path.join(SOURCE_DIR, 'journal_taxonomy_scope.csv')
# 2026-10-26 (the owner: "the real classification that i want you to work on is from the journal (specialty) to group to
# higher-level group"): the groups, built from the journals up within the same higher-level groups (three independent
# designs, a judge, then two blind placers who re-placed all 231 journals from the definitions alone and agreed with
# the design on every one): each group's definition and the journals' own scope words that hold it together
GROUPS_FILE = os.path.join(SOURCE_DIR, 'journal_groups.csv')
SPECIALTY_HOSTS = os.path.join(SOURCE_DIR, 'specialty_hosts.csv')    # 2026-10-25: specialty journal -> host law school
WL_CROSSWALK = os.path.join(SOURCE_DIR, 'wl_subject_taxonomy.csv')    # W&L subject -> area > field, for journals not mapped yet
# the order the areas are listed in (research/taxonomy: 13 subject areas, then the methods)
AREA_ORDER = ['Constitutional & Public Law', 'Courts, Litigation & Dispute Resolution', 'Criminal Law & Justice',
              'Business & Financial Law', 'Tax, Trusts & Estates', 'Property, Environment & Natural Resources',
              'International & Comparative Law', 'Science, Technology & IP', 'Health Law & Bioethics',
              'Civil Rights, Equality & Family', 'Labor & Employment', 'Legal Profession & Education',
              'Legal Theory, Humanities & Society', 'Interdisciplinary Methods', 'General & Policy Journals']
DEFAULT_FLAGSHIP_TOP = 25     # the site's default view: main law reviews of the US News top 25 (tiers 1-3 and 4-25)
DEFAULT_VIEW = f'flagship law reviews of the US News top {DEFAULT_FLAGSHIP_TOP} schools, the ten years ending at the latest well-collected year, US law schools'


# Short pieces (the owner, 2026-10-23: a real classifier, not title rules; 2026-10-25: a trained model with stratified
# k-fold validation, and page lengths for everything). A piece is short when its measured length (from HeinOnline's
# page numbers) is under 10 pages, or it is a memorial under 20; without a measured length, when the deployed model
# (models/ in the data folder: scikit-learn, trained on the measured pieces) says so; an older language-model call
# (short_pieces/cache.jsonl) where the model has no prediction; otherwise it counts. The site's "Skip short pieces"
# box leaves short pieces out.
SHORT_DIR = os.path.join(SOURCE_DIR, 'short_pieces')
CREDITED_KEYS = os.path.join(SHORT_DIR, 'credited_keys.txt')
MODEL_SHORT = os.path.join(SHORT_DIR, 'model_short.csv')          # the deployed short-piece model's predictions
MODELS_DIR = os.path.join(SOURCE_DIR, 'models', 'artifacts')    # what the classifier does next (a test build redirects it)
# BETA (2026-10-26, the owner: "the title area classification mark as a beta function. so the website doesn't operate
# using that by default but a user can see what it would look like"): models/title_area.py's category for every title
TITLE_AREA = os.path.join(MODELS_DIR, 'title_area_predictions.csv')
TITLE_AREA_MIN_P = 0.5      # only titles the model is at least this sure of count toward a person's beta categories
PIECE_KINDS = ['research article', 'essay', 'book review', 'response or reply', 'foreword or introduction', 'memorial or tribute',
               'lecture, speech or remarks', 'student note or comment', 'transcript or panel discussion',
               'case or legislation summary', 'editorial or front matter', 'correction', 'other']
SHORT_KINDS = {'memorial or tribute', 'foreword or introduction', 'lecture, speech or remarks', 'transcript or panel discussion',
               'editorial or front matter', 'correction'}
SHORT_PAGES = 10


def load_short_model():
    '''2026-10-25: the deployed short-piece model (a trained classifier, models/ in the data folder: stratified
    k-fold by journal): piece key -> short?, and the model's cross-validated scores for the FAQ'''
    flags, info = {}, None
    if os.path.exists(MODEL_SHORT):
        try:
            m = read_csv_safely(MODEL_SHORT)
            flags = dict(zip(m['key'], m['p_short'] >= m['threshold']))
            version = str(m['version'].iloc[0]) if len(m) else ''
            report = os.path.join(MODELS_DIR, f'short-{version}.json')
            if version and os.path.exists(report):
                r = json.load(open(report, encoding='utf-8'))
                info = {'version': version, 'trained_rows': r['labeled_rows'], 'folds': r['config']['folds'],
                        'precision': round(r['pooled']['precision'], 3), 'recall': round(r['pooled']['recall'], 3),
                        'f1': round(r['pooled']['f1'], 3), 'roc_auc': round(r['pooled']['roc_auc'] or 0, 3),
                        'baseline_f1': round(r['baseline']['f1'], 3)}
        except Exception as e:
            print(f'  !! the short-piece model\'s predictions could not be read ({e!r}); unmeasured pieces count')
            flags = {}
    return flags, info


def load_classes():
    '''piece key -> (kind, estimated pages, short?) . short.csv (combine.py: the language model's reading plus the
    journal's measured statistics, threshold set by cross-validation) when it has the piece; otherwise the language
    model's own call from cache.jsonl'''
    out = {}
    path = os.path.join(SHORT_DIR, 'cache.jsonl')
    if os.path.exists(path):
        with open(path, 'rb') as f:          # bytes: a line torn inside a non-ASCII character is skipped (stress test)
            for line in f:
                try:
                    r = json.loads(line.decode('utf-8'))
                    pages = r.get('pages')
                    pages = float(pages) if pages is not None else None
                    out[r['key']] = (r['kind'], pages, r['kind'] in SHORT_KINDS or (pages is not None and pages < SHORT_PAGES))
                except (ValueError, KeyError, TypeError, UnicodeDecodeError, AttributeError):
                    pass
    combined = os.path.join(SHORT_DIR, 'short.csv')
    if os.path.exists(combined):
        try:
            c = read_csv_safely(combined)
        except Exception as e:
            print(f'  !! short_pieces/short.csv could not be read ({e!r}); the classifier\'s own calls are used')
            c = pd.DataFrame(columns=['key', 'p_short', 'threshold'])
        for r in c.itertuples():
            if r.key in out:
                out[r.key] = (out[r.key][0], out[r.key][1], bool(r.p_short >= r.threshold))
    return out


# no 'v': "Smith, John V." is a middle initial far more often than a fifth-generation suffix (stress test t14)
NAME_SUFFIXES = {'jr', 'sr', 'ii', 'iii', 'iv'}
# (naming audit, 2026-10-26) Hein tags namesakes it tells apart: "Gardner, James A. (I)", "Johnson, Stephen (II)",
# "Smith, John (Boston)". The tag is part of who the person is ("gardner#i"), never a middle initial or a suffix: read
# as those, the 1957-65 papers of "Gardner, James A. (I)" went to Buffalo's James A. Gardner (first papers 1984).
# Nickname parentheticals ("(Tony)", "(Mae)") are left as they were.
MANY_SIGNER_WORDS = ('tribute', 'dedication', 'remembrance', 'memoriam', 'transcript', 'roundtable', 'panel', 'discussion', 'conference')
NAME_TAG = re.compile(r'\s*\((?P<t>i{1,3}|iv|vi{0,3}|ix|x|\d+|duke|boston|ua|washu)\)\s*$', re.I)

# US News name -> name used on Hein's AuthorBySchool list, where normalizing alone can't line them up
USNEWS_TO_HEIN = {
    'CUNY School of Law': 'City University of New York (CUNY)',
    'Widener University--Pennsylvania (Commonwealth)': 'Widener University Commonwealth Law School',
}


################################################ names

def parse_hein_name(url):
    '''Hein author links carry "Last, First Middle" in search_name; returns (last, first, middle) lowercased, no punctuation'''
    raw = parse_qs(urlparse(str(url)).query).get('search_name', [''])[0]
    name = unquote(raw).strip()
    tag = NAME_TAG.search(name)
    if tag:
        name, tag = name[:tag.start()].strip(), '#' + tag.group('t').lower()
    if ',' in name:
        last, rest = name.split(',', 1)
    else:
        last, rest = name, ''
    # (naming audit) a block of two or three capitals with no periods after the comma is initials: "Ard, BJ" is
    # "Ard, B. J." (so both spellings are one name)
    if re.fullmatch(r'\s*[A-Z]{2,3}\s*', rest):
        rest = ' '.join(rest.strip())
    # 2026-10-23 (stress tests t7, t14, t17): accents folded (José = Jose), letters of any script kept (an all-CJK
    # name no longer becomes ""), hyphens and apostrophes joined (Smith-Jones = Smith Jones, O'Brien = OBrien),
    # a suffix is found wherever it is ("Skeel Jr., David" = "Skeel, David Jr.") and kept with the last name as
    # "skeel|jr", so Robert L. Jones and Robert L. Jones Jr. stay two people (match_authors can still match a
    # paper that leaves the suffix off)
    fold = lambda s: ''.join(c for c in unicodedata.normalize('NFKD', s.lower()) if not unicodedata.combining(c))
    words = lambda s: re.sub(r'[^\w ]', ' ', re.sub(r"[-'’]", '', fold(s))).split()
    suffix = next((p for p in words(last) + words(rest) if p in NAME_SUFFIXES), '')
    last = ''.join(p for p in words(last) if p not in NAME_SUFFIXES) + (tag or '') + ('|' + suffix if suffix else '')
    parts = [p for p in words(rest) if p not in NAME_SUFFIXES]
    first = parts[0] if parts else ''
    middle = ' '.join(parts[1:])
    return last, first, middle


def roster_parse(link):
    '''parse_hein_name for a faculty-list entry. (naming audit, 2026-10-26) An entry without a comma is not one long
    surname: "Jordan. Elizabeth" (a period for the comma) is "Jordan, Elizabeth", and natural order ("Young Ran
    (Christine) Kim", "William Wesley Patton") is "Kim, Young Ran (Christine)". One-word names stay as they are.'''
    name = unquote(parse_qs(urlparse(str(link)).query).get('search_name', [''])[0]).strip()
    if ',' in name or len(name.split()) < 2:
        return parse_hein_name(link)
    m = re.match(r'^([^\s.]+)\.\s+(.+)$', name)
    if m:
        fixed = m.group(1) + ', ' + m.group(2)
    else:
        toks = name.split()
        suffix = [t for t in toks if t.lower().strip('.,') in NAME_SUFFIXES]
        toks = [t for t in toks if t not in suffix]
        fixed = toks[-1] + ', ' + ' '.join(toks[:-1] + suffix)
    return parse_hein_name(hein_profile_link(fixed))


def display_name(hein_name):
    '''"Skeel, David Arthur Jr." -> "David Arthur Skeel Jr."'''
    if ',' not in hein_name:
        return hein_name.strip()
    last, rest = [p.strip() for p in hein_name.split(',', 1)]
    parts = rest.split()
    suffix = [p for p in parts if p.lower().strip('.,') in NAME_SUFFIXES]
    given = [p for p in parts if p not in suffix]
    return ' '.join(given + [last] + suffix)


def raw_last(url):
    '''last name with its spaces, hyphens and apostrophes kept as breaks ("d'Avis" -> "d avis", "Davis" -> "davis")'''
    raw = unquote(parse_qs(urlparse(str(url)).query).get('search_name', [''])[0]).split(',')[0]
    folded = ''.join(c for c in unicodedata.normalize('NFKD', raw.lower()) if not unicodedata.combining(c))
    return ' '.join(w for w in re.sub(r'[^\w]', ' ', folded).split() if w not in NAME_SUFFIXES)


def joined_prefix(a, b):
    '''the two raw last names differ, and one of them starts with a one-letter particle (d', l', o')'''
    return a != b and any(len(x.split()) > 1 and len(x.split()[0]) == 1 for x in (a, b))


def middles_compatible(a, b):
    return not a or not b or a[0] == b[0]


# (naming audit, 2026-10-26) formal first names and their usual short forms (both directions), for the second pass of
# match_by_name ("Schragger, Rich" / "Schragger, Richard C.")
NICKNAMES = {
    'william': 'bill billy will willie liam', 'robert': 'bob bobby rob robbie bert', 'richard': 'dick rick rich richie ricky',
    'james': 'jim jimmy jamie', 'john': 'jack johnny jon', 'jonathan': 'jon jonny', 'joseph': 'joe joey', 'thomas': 'tom tommy',
    'michael': 'mike mick mickey', 'daniel': 'dan danny', 'david': 'dave davey', 'christopher': 'chris kit', 'christine': 'chris',
    'christina': 'chris tina', 'charles': 'chuck charlie chas chaz', 'edward': 'ed eddie ted ned', 'edwin': 'ed', 'edmund': 'ed ted',
    'elizabeth': 'liz beth betsy betty libby lisa eliza liza', 'katherine': 'kate kathy katie kat kay', 'catherine': 'cathy kate cate katie',
    'kathryn': 'kate kathy katie', 'kathleen': 'kathy kate katie', 'margaret': 'peg peggy maggie meg marge margie greta',
    'jennifer': 'jen jenny jenn', 'jessica': 'jess jessie', 'rebecca': 'becky becca', 'deborah': 'deb debbie debby', 'debra': 'deb debbie',
    'patricia': 'pat patty trish tricia', 'patrick': 'pat', 'susan': 'sue susie', 'suzanne': 'sue suzy', 'samuel': 'sam sammy',
    'samantha': 'sam', 'benjamin': 'ben benji', 'nicholas': 'nick nicky', 'nicole': 'nikki', 'alexander': 'alex al sandy',
    'alexandra': 'alex sandra sandy', 'alexis': 'alex', 'anthony': 'tony', 'antonio': 'tony', 'andrew': 'andy drew', 'gregory': 'greg',
    'jeffrey': 'jeff', 'geoffrey': 'geoff jeff', 'stephen': 'steve', 'steven': 'steve', 'kenneth': 'ken kenny',
    'lawrence': 'larry', 'laurence': 'larry', 'leonard': 'len lenny', 'ronald': 'ron ronnie', 'donald': 'don donnie',
    'timothy': 'tim timmy', 'matthew': 'matt', 'peter': 'pete', 'philip': 'phil', 'phillip': 'phil', 'raymond': 'ray',
    'gerald': 'jerry gerry', 'jerome': 'jerry', 'harold': 'hal harry', 'henry': 'hank harry hal', 'frederick': 'fred freddie rick',
    'francis': 'frank fran', 'franklin': 'frank', 'albert': 'al bert', 'alfred': 'al fred', 'allen': 'al', 'alan': 'al',
    'eugene': 'gene', 'douglas': 'doug', 'theodore': 'ted teddy theo', 'walter': 'walt wally', 'zachary': 'zach zack',
    'nathaniel': 'nate nat', 'nathan': 'nate', 'jacob': 'jake', 'joshua': 'josh', 'abraham': 'abe', 'mitchell': 'mitch',
    'randall': 'randy', 'randolph': 'randy', 'russell': 'russ', 'stanley': 'stan', 'vincent': 'vince', 'victoria': 'vicky tori',
    'cynthia': 'cindy', 'pamela': 'pam', 'barbara': 'barb barbie', 'judith': 'judy', 'sandra': 'sandy', 'dorothy': 'dot dottie',
    'virginia': 'ginny', 'carolyn': 'carol', 'caroline': 'carol carrie', 'abigail': 'abby', 'gabrielle': 'gabby', 'gabriel': 'gabe',
    'frances': 'fran frankie', 'josephine': 'jo josie', 'joanne': 'jo', 'johanna': 'jo', 'theresa': 'terry tess', 'teresa': 'terry tess',
    'terence': 'terry', 'terrence': 'terry', 'valerie': 'val', 'veronica': 'ronnie', 'maximilian': 'max', 'maxwell': 'max',
    'montgomery': 'monty', 'clifford': 'cliff', 'bradley': 'brad', 'bradford': 'brad', 'cameron': 'cam', 'harrison': 'harry',
    'jacqueline': 'jackie', 'melissa': 'missy mel', 'melanie': 'mel', 'amanda': 'mandy', 'kimberly': 'kim', 'pamala': 'pam',
    'leslie': 'les', 'lester': 'les', 'louis': 'lou', 'louise': 'lou', 'marjorie': 'margie', 'martin': 'marty', 'mathew': 'matt',
    'oliver': 'ollie', 'reginald': 'reggie', 'rodney': 'rod', 'roderick': 'rod', 'ronan': 'ro', 'solomon': 'sol', 'sylvia': 'syl',
    'tobias': 'toby', 'vernon': 'vern', 'wesley': 'wes', 'wilfred': 'will', 'winifred': 'winnie', 'evan': 'ev', 'eleanor': 'ellie nell',
    'helen': 'nell', 'ellen': 'nell', 'anne': 'annie', 'ann': 'annie', 'susanna': 'sue', 'jeremy': 'jerry', 'jeremiah': 'jerry',
    'herbert': 'herb', 'howard': 'howie', 'isaac': 'ike', 'irving': 'irv', 'marvin': 'marv', 'morton': 'mort', 'mortimer': 'mort',
    'norman': 'norm', 'seymour': 'sy', 'sidney': 'sid', 'sydney': 'syd', 'gerard': 'gerry', 'clarence': 'clay', 'calvin': 'cal',
    'carl': 'carl', 'karl': 'karl', 'benedict': 'ben', 'bernard': 'bernie', 'arnold': 'arnie', 'arthur': 'art', 'augustus': 'gus',
    'dennis': 'denny', 'edgar': 'ed', 'emily': 'em', 'florence': 'flo', 'gwendolyn': 'gwen', 'harriet': 'hattie', 'jane': 'janie',
    'janet': 'jan', 'janice': 'jan', 'kristen': 'kris', 'kristin': 'kris', 'kristina': 'kris tina', 'christian': 'chris',
    'lillian': 'lil', 'madeline': 'maddie', 'madeleine': 'maddie', 'mary': 'molly polly mae', 'miriam': 'mimi', 'rosemary': 'rose',
    'stephanie': 'steph', 'tamara': 'tammy', 'trevor': 'trev', 'vivian': 'viv', 'wendell': 'wendy', 'yvonne': 'vonnie',
    'zachariah': 'zach', 'cornelius': 'neil', 'aaron': 'ari', 'ariel': 'ari', 'daniela': 'dani', 'danielle': 'dani',
    'eliot': 'eli', 'elliott': 'eli', 'elijah': 'eli', 'ezekiel': 'zeke', 'jessie': 'jess', 'joel': 'joe', 'jody': 'jo',
    'lucas': 'luke', 'luke': 'luke', 'meredith': 'merry', 'olivia': 'liv', 'penelope': 'penny', 'priscilla': 'cilla',
    'roberta': 'bobbi', 'ruth': 'ruthie', 'thaddeus': 'tad', 'virgil': 'virg', 'woodrow': 'woody', 'jerold': 'jerry',
}
NICK_OF = defaultdict(set)
for _formal, _short in NICKNAMES.items():
    for _n in _short.split():
        if _n != _formal:
            NICK_OF[_formal].add(_n)
            NICK_OF[_n].add(_formal)
HONORIFICS = {'hon', 'honorable', 'judge', 'justice', 'professor', 'prof', 'dr', 'rev', 'reverend'}
COMMON_SURNAME = 120     # first names written with one surname in the data: Smith, Davis, Clark ... (Glover: 44)
BENCH = {'hon', 'honorable', 'judge', 'justice', 'chief'}     # a judge's title: only someone listed at a court
# (naming audit, 2026-10-26) a spelling and a listing that the second pass would join but that are two people, found by
# reading the candidates: (paper spelling, faculty-list name, school)
KNOWN_NAMESAKES = {('Kaye, David H.', 'Kaye, David', 'University of California, Irvine')}   # the forensic-evidence scholar


def split_last(last):
    '''"brakmanreiser#ii|jr" -> ("brakmanreiser", "ii", "jr"): surname, Hein's namesake tag, suffix'''
    b, _, suf = last.partition('|')
    base, _, tag = b.partition('#')
    return base, tag, suf


################################################ inputs

def infer_year(volume):
    return js.infer_year(volume)


def load_papers():
    '''every journal in the data folder's journal_store/, plus when each was last checked'''
    rows, coverage = [], []
    for f in sorted(glob.glob(os.path.join(SOURCE_DIR, js.STORE_DIR, 'j___*.csv'))):
        journal = os.path.basename(f)[len('j___'):-len('.csv')]
        df, state = js.load_store(journal, repair=False)   # current copies; read-only (a run may be appending)
        # PATCH 17 (2026-10-25): each piece's length from every table-of-contents entry, signed or not, before the
        # unsigned entries (issue headers, unsigned notes) are dropped
        df = df.assign(length=js.entry_lengths(df))
        df = df[(df['title'] != '') & (df['author'] != '')].copy()
        df = df[~df['volume'].str.contains(js.INDEX_LABEL)]   # index volumes (a few editors' notes, not articles)
        if df.empty:
            continue
        df['title_key'] = df['title'].map(js.title_key)
        df['author_key'] = df['author'].map(js.author_key)
        # (pairing audit, 2026-10-26) an author link with an empty name is no author: it counted as a phantom co-author
        # and halved five faculty members' credit
        df = df[(df['title_key'] != '') & (df['author_key'] != '')]
        df['journal'] = journal
        df['year'] = df['volume'].map(infer_year)
        rows.append(df)
        vols = state.get('volumes', {})
        newest_volume = max((v.get(js.COLLECTED_AT) or '' for v in vols.values()), default='')
        collected = (state.get('checked_at') or newest_volume)[:10]
        coverage.append({
            'journal': journal,
            'collected': collected,
            'latest_year': None if df['year'].isna().all() else int(df['year'].max()),
            'papers': int(df.groupby(['volume_key', 'title_key']).ngroups),
            # (audit, 2026-10-25) a journal whose every volume has been re-read and verified is verified too: only the
            # repair pass set verified_at, so 49 of the 55 fully verified journals showed "not yet" in the FAQ
            'verified': bool(state.get('verified_at')) or (bool(vols) and all(v.get('status') == 'verified' for v in vols.values())),
            'volumes_to_recheck': sum(1 for v in vols.values() if v.get('status') == 'suspect'),
        })
    papers = pd.concat(rows, ignore_index=True)
    papers = papers[papers['year'].notna()]
    papers['year'] = papers['year'].astype(int)
    return papers, pd.DataFrame(coverage)


def read_csv_safely(path, **kw):
    '''a CSV that a run may have left with half a line at the end (killed mid-append): that line is dropped'''
    with open(path, 'rb') as f:
        raw = f.read()
    if raw and not raw.endswith(b'\n'):
        raw = raw[:raw.rfind(b'\n') + 1]
    return pd.read_csv(io.BytesIO(raw), **kw)


def hein_profile_link(hein_name):
    return 'https://heinonline.org/HOL/AuthorProfile?action=edit&search_name=' + quote(hein_name.strip()) + '&collection=journals'


# (audit, 2026-10-25) the owner: "focus on the authors and pulling links" to each person's faculty bio. The website
# column of Hein's school CSVs is typed in by the schools, and some values are not a working bio page: a browser's
# "#:~:text=" highlight fragment (Gilles at Northwestern, Kettler at GW), a link wrapped by a mail filter
# (linkprotect.cudasvc.com, Outlook safelinks, google.com/url), two URLs run together ("https://law.https://law.
# rutgers.edu/..."), a library proxy (*.idm.oclc.org, ezproxy), a staging host (Creighton's *.pantheonsite.io), or no
# web page at all ("www.x.de" with no scheme, a CV as a PDF). Wrappers and fragments are cleaned; the rest is
# rejected, and those people go to missing_homepages.csv, where faculty_links.py looks for their pages.
LINK_WRAPPERS = {'linkprotect.cudasvc.com': 'a', 'safelinks.protection.outlook.com': 'url', 'www.google.com': 'url'}
PROXY_HOST = re.compile(r'(^|\.)idm\.oclc\.org$|(^|\.)ezproxy\.|\.pantheonsite\.io$')
NOT_A_PAGE = re.compile(r'\.(pdf|docx?|rtf|pptx?|xlsx?|jpe?g|png|gif)$', re.I)
# (naming audit, 2026-10-25) never a homepage: HeinOnline (the owner: "Drop hein links throughout") and a search
# engine's pages (its link wrapper is unwrapped first)
NOT_A_HOMEPAGE = re.compile(r'(^|\.)heinonline\.org$')
# (naming audit, 2026-10-26) whole URL schemes a school has retired, each fetched and found to redirect to the faculty
# listing or to a dead page: Michigan's FacultyBio.aspx, Idaho's /law/people/faculty/<one word>, Cincinnati's
# /education/faculty/
RETIRED_SCHEME = re.compile(r'law\.umich\.edu/facultybio|uidaho\.edu/law/people/faculty/[^/-]+/?$|law\.uc\.edu/education/faculty/', re.I)
SEARCH_ROOTS = re.compile(r'^(www\.)?(google|bing|duckduckgo|yahoo)\.[a-z.]+$')


def clean_homepage(site):
    '''(url, what was done): what is '' when the value is used as it is, 'cleaned: ...' or 'rejected: ...' (url '')'''
    site = str(site or '').strip()
    if not site:
        return '', ''
    done = []
    # (naming audit) "http://https://..." and a bare "www.school.edu/..." are fixable
    m = re.match(r'https?://(?=https?://)', site, re.I)
    if m:
        site = site[m.end():]
        done.append('doubled scheme')
    if re.match(r'www\.', site, re.I):
        site = 'https://' + site
        done.append('scheme added')
    for _ in range(2):        # a wrapper inside a wrapper
        u = urlparse(site)
        host = (u.hostname or '').lower()
        param = next((p for h, p in LINK_WRAPPERS.items() if host == h or host.endswith('.' + h)), None)
        if param and (host != 'www.google.com' or u.path == '/url'):
            target = parse_qs(u.query).get(param, [''])[0].strip()
            if not target:
                return '', 'rejected: link wrapper without a target'
            site = target
            done.append('link wrapper')
    half = len(site) // 2
    if len(site) % 2 == 0 and site[:half] == site[half:] and re.match(r'https?://', site, re.I):
        site = site[:half]                        # the same URL typed twice ("https://law.yale.edu/jason-parkinhttps://...")
        done.append('doubled URL')
    if '#' in site:
        base, frag = site.split('#', 1)
        if ':~:' in frag:                         # a text highlight (#:~:text=...), with any anchor before it kept
            frag = frag.split(':~:', 1)[0]
            site = base + ('#' + frag if frag else '')
            done.append('text fragment')
    u = urlparse(site)
    host = (u.hostname or '').lower()
    if u.scheme.lower() not in ('http', 'https'):
        return '', 'rejected: not an http(s) address'
    if len(re.findall(r'https?:/', site.split('?', 1)[0], re.I)) > 1:
        return '', 'rejected: two addresses run together'
    if not re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+', host) or re.search(r'\s', site):
        return '', 'rejected: not a valid address'
    if PROXY_HOST.search(host):
        return '', 'rejected: library proxy or staging host'
    if NOT_A_HOMEPAGE.search(host):
        return '', 'rejected: HeinOnline, not a faculty page'
    if RETIRED_SCHEME.search(host + u.path):
        return '', 'rejected: retired URL scheme (redirects to the listing or is gone)'
    if SEARCH_ROOTS.match(host):
        return '', 'rejected: a search engine page'
    if NOT_A_PAGE.search(u.path):
        return '', 'rejected: a file, not a page'
    return site, ('cleaned: ' + ', '.join(done)) if done else ''


def load_school_csvs():
    """HeinOnline's per-school faculty CSV, in faculty_runs/school_csv/<school>.csv (index.json there names the school
    each file is for) and, in the older layout, faculty_runs/<pass>.csv_metric/. Every file is read, oldest file first, so the newest wins. Returns
    ({(school, norm(search_name)): {'website', 'title', 'orcid', 'school'}}, set of schools read). Its website column is
    the faculty homepage for nearly everyone (2026-10-24 sample: Northwestern 133/133, Harvard 150/150).
    Stress test (2026-10-24): the build read only the old per-pass folders, so no homepage ever reached the site; and
    rows were keyed by name alone, so a person who moved could get their old school's homepage."""
    safe = lambda school: re.sub(r'[^\w.-]+', '_', school).strip('_') + '.csv'      # main.save_school_csv's file name
    try:
        index = json.load(open(os.path.join(SCHOOL_CSV_DIR, 'index.json'), encoding='utf-8'))
    except (OSError, ValueError):
        index = {}
    school_of_file = {safe(s): s for s in index}
    files = []
    for d in sorted(glob.glob(SCHOOL_CSVS)) + [SCHOOL_CSV_DIR]:
        for f in glob.glob(os.path.join(d, '*.csv')):
            named = school_of_file.get(os.path.basename(f)) if d == SCHOOL_CSV_DIR else None
            files.append((os.path.getmtime(f), f, named))
    out, schools = {}, set()
    fixed = {}                                   # (audit) (school, name) -> what clean_homepage did to its website
    for _, f, named in sorted(files):            # oldest file first
        try:
            df = read_csv_safely(f, dtype=str).fillna('')
        except Exception as e:
            print(f'  !! could not read {f}: {e!r}')
            continue
        if 'search_name' not in df.columns:
            continue
        for r in df.to_dict('records'):
            key = hp.norm_form(r.get('search_name', ''))
            school = named or str(r.get('university', '')).strip()
            if not key or not school:
                continue
            try:
                site, fixed[(school, key)] = clean_homepage(r.get('website', ''))
            except ValueError:                   # urlparse on a malformed address ("http://[...")
                site, fixed[(school, key)] = '', 'rejected: not a valid address'
            out[(school, key)] = {'website': site, 'title': str(r.get('title', '')).strip(),
                                  'orcid': str(r.get('ORCID', '')).strip(), 'school': school,
                                  'surname': raw_last(hein_profile_link(str(r.get('search_name', ''))))}
            schools.add(school)
    # (audit, 2026-10-25) counted over the rows in use (the newest file for each person)
    what = defaultdict(int)
    for v in fixed.values():
        if v:
            what[v] += 1
    cleaned = sum(n for v, n in what.items() if v.startswith('cleaned'))
    rejected = sum(n for v, n in what.items() if v.startswith('rejected'))
    if cleaned or rejected:
        print(f'  (audit) homepages from the school CSVs: {cleaned} cleaned, {rejected} rejected (to missing_homepages.csv):',
              dict(sorted(what.items(), key=lambda x: -x[1])))
    # (review, 2026-10-25) a website that 3 or more people at one school share is the school's faculty listing
    # (Ave Maria: 23 people, Montana: 12), not anyone's homepage: none, so they go to missing_homepages.csv and
    # faculty_links.py looks for their own pages (it uses such a listing as the school's directory)
    shared = defaultdict(int)
    for (school, _), v in out.items():
        if v['website']:
            shared[(school, v['website'].rstrip('/'))] += 1
    for (school, _), v in out.items():
        if v['website'] and shared[(school, v['website'].rstrip('/'))] >= 3:
            v['website'] = ''
    not_theirs(out)
    return out, schools


def norm_url(u):
    '''an address without scheme, "www.", fragment, trailing slash or index/default page: two spellings of one page meet'''
    p = urlparse(u)
    host = (p.hostname or '').lower()
    host = host[4:] if host.startswith('www.') else host
    path = re.sub(r'/(index|default)\.[a-z]+$', '', p.path, flags=re.I).rstrip('/')
    return host + path + ('?' + p.query if p.query else '')


LISTING_WORDS = re.compile(r'^(faculty|people|directory|staff|all|our-faculty|faculty-directory|faculty-and-staff|'
                           r'(emerit(us|i)|full-time|adjunct|visiting)-faculty|instructors-in-law|law-faculty-experts|'
                           r'law-school-contacts|profiles|faculty-staff|our-people)(\.[a-z]+)?$', re.I)
ROLE_URL = re.compile(r'president|chancellor|provost', re.I)
OTHER_SCHOOL_OK = {'uchastings.edu', 'wgtn.ac.nz', 'unt.edu'}   # a school's former or parent domain (naming audit)


def not_theirs(out):
    '''(naming audit, 2026-10-26) school-CSV websites that are not the person's own page at this school, blanked so the
    person goes to missing_homepages.csv (where faculty_links.py looks for the page by the school's naming convention):
      listing    a listing or directory page: shared by 2+ people at the school and naming none of them; the parent
                 folder of 2+ other people's pages there; or a last segment that is a listing word ("faculty",
                 "people", "emeritus-faculty") or the bare root of the site, without the person's surname
      other      another university's site (.edu, .ac.xx) that the school's own pages do not use (3+ of them), e.g.
                 Columbia's Gabriel Rauterberg at michigan.law.umich.edu: a move the CSV has not caught up with
      role       an office's page (president, chancellor, provost) without the person's surname: Wisconsin's
                 chancellor page now shows the next chancellor'''
    def names(v, u):
        flat = re.sub(r'[^a-z]', '', u.lower())
        return any(len(w) >= 3 and w in flat for w in v['surname'].split())
    def domain(host):
        labels = host.split('.')
        return '.'.join(labels[-3:]) if len(labels) >= 3 and labels[-2] in ('ac', 'edu') else '.'.join(labels[-2:])
    by_school = defaultdict(list)
    for k, v in out.items():
        if v['website']:
            by_school[v['school']].append((k, v, norm_url(v['website'])))
    why = defaultdict(int)
    for school, items in by_school.items():
        sharers = defaultdict(list)
        for k, v, n in items:
            sharers[n].append(v)
        own = defaultdict(int)
        for k, v, n in items:
            own[domain(n.split('/')[0])] += 1
        own = {d for d, c in own.items() if c >= 3}
        for k, v, n in items:
            host, _, path = n.partition('/')
            last_seg = path.rsplit('/', 1)[-1].split('?')[0] if path else ''
            children = sum(1 for _, _, m in items if m != n and m.startswith(n + '/'))
            if ((len(sharers[n]) >= 2 and not any(names(x, v['website']) for x in sharers[n])) or children >= 2
                    or ((not path or LISTING_WORDS.match(last_seg)) and not names(v, v['website']))):
                reason = 'listing'
            elif (own and domain(host) not in own and domain(host) not in OTHER_SCHOOL_OK
                    and re.search(r'\.(edu|ac\.[a-z]+|edu\.[a-z]+)$', host)):
                reason = 'other'
            elif ROLE_URL.search(n) and not names(v, v['website']):
                reason = 'role'
            else:
                continue
            why[reason] += 1
            v['website'] = ''
    if why:
        print('  (naming audit) school-CSV websites not the person\'s own page here, left for faculty_links.py:', dict(why))


def load_faculty_edits():
    '''faculty/edits.csv (pull requests welcome): action, hein_name, school, name, homepage, note'''
    if not os.path.exists(FACULTY_EDITS):
        return pd.DataFrame(columns=['action', 'hein_name', 'school', 'name', 'homepage', 'note'])
    # stress test (2026-10-24): one unquoted comma in a pull request made every build crash; bad lines are skipped
    # and named, and a file without the expected columns is ignored
    bad_lines = []
    try:
        e = pd.read_csv(FACULTY_EDITS, dtype=str, engine='python', on_bad_lines=lambda line: bad_lines.append(line) and None).fillna('')
    except Exception as ex:
        print(f'  !! faculty/edits.csv could not be read ({ex!r}); ignored this build')
        return pd.DataFrame(columns=['action', 'hein_name', 'school', 'name', 'homepage', 'note'])
    if bad_lines:
        print(f'  !! faculty/edits.csv: {len(bad_lines)} malformed lines skipped (wrong number of commas?):', bad_lines[:3])
    for col in ['action', 'hein_name', 'school', 'name', 'homepage', 'note']:
        if col not in e.columns:
            if col in ('action', 'hein_name'):
                print(f'  !! faculty/edits.csv has no "{col}" column; ignored this build')
                return pd.DataFrame(columns=['action', 'hein_name', 'school', 'name', 'homepage', 'note'])
            e[col] = ''
    e['action'] = e['action'].str.strip().str.lower()
    bad = e[~e['action'].isin(['add', 'remove', 'move', 'alias', 'homepage'])]
    if len(bad):
        print(f'  !! faculty/edits.csv: {len(bad)} rows with an unknown action, ignored:', bad['action'].tolist()[:5])
    return e[e['action'].isin(['add', 'remove', 'move', 'alias', 'homepage'])]


def apply_faculty_edits(df):
    '''add / remove / move people on the faculty lists, from faculty/edits.csv'''
    e = load_faculty_edits()
    if e.empty:
        return df
    key = lambda name: parse_hein_name(hein_profile_link(name))
    df_keys = df['link'].map(parse_hein_name)
    n = defaultdict(int)
    for r in e.itertuples():
        if r.action == 'remove':
            hit = (df_keys == key(r.hein_name)) & ((df['school'] == r.school) if r.school else True)
            df, df_keys = df[~hit], df_keys[~hit]
            n['removed'] += int(hit.sum())
        elif r.action in ('add', 'move'):
            if r.action == 'move':
                hit = df_keys == key(r.hein_name)
                df, df_keys = df[~hit], df_keys[~hit]
            row = {'school': r.school, 'author': r.hein_name, 'link': hein_profile_link(r.hein_name), 'run': 'faculty/edits.csv'}
            df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
            df_keys = df['link'].map(parse_hein_name)
            n[r.action + 'ed' if r.action == 'add' else 'moved'] += 1
    print('  faculty/edits.csv applied:', dict(n) or 'nothing to change on the lists')
    return df.reset_index(drop=True)


def write_faculty_list(roster):
    '''faculty/list-<letter>.csv: every person on the lists this build used (Hein's lists plus faculty/edits.csv),
    one file per first letter of the last name, like CSrankings' csrankings-<letter>.csv'''
    os.makedirs(FACULTY_LIST_DIR, exist_ok=True)
    out = pd.DataFrame({
        'name': roster['author'].map(lambda a: display_name(str(a))),
        'school': roster['school'],
        'hein_name': roster['hein_name'],
        'source': roster['run'],      # (2026-10-25, the owner: "Drop hein links throughout"): no profile links
    }).sort_values(['hein_name', 'school'])
    letter = out['hein_name'].str.strip().str[:1].str.lower().where(lambda c: c.str.match(r'[a-z]'), 'other')
    for f in glob.glob(os.path.join(FACULTY_LIST_DIR, 'list-*.csv')):
        os.remove(f)
    for l, part in out.groupby(letter):
        part.to_csv(os.path.join(FACULTY_LIST_DIR, f'list-{l}.csv'), index=False)
    print(f'  wrote faculty/list-*.csv ({len(out)} listings)')


def load_roster():
    '''newest faculty list for each school, from get_authors_from_v3 runs (faculty_runs/) and the older authors_latest.csv'''
    sources = []   # oldest first
    old = os.path.join(SOURCE_DIR, 'authors_latest.csv')
    if os.path.exists(old):
        sources.append(('authors_latest', read_csv_safely(old).rename(columns={'name': 'author'}), True))
    for f in sorted(glob.glob(os.path.join(SOURCE_DIR, 'faculty_runs', 'authors_*.csv'))):
        run = os.path.basename(f)[:-len('.csv')]
        complete = os.path.exists(f[:-len('.csv')] + '.done')
        sources.append((run, read_csv_safely(f), complete))

    # (stress test, 2026-10-24) a finished pass with under half the people of the finished list before it is broken
    # (a page whose person links were not found, every school then accepted as empty): it is not used
    good = []
    for src in sources:
        prev_done = [len(d) for _, d, c in good if c]
        if src[2] and prev_done and len(src[1]) < 0.5 * prev_done[-1]:
            print(f'  !! faculty list {src[0]} has {len(src[1])} people, against {prev_done[-1]} before: ignored as broken')
            continue
        good.append(src)
    sources = good

    # the newest finished run decides which schools exist (Hein drops schools too);
    # runs after it are still in progress and replace the lists for the schools they reached
    last_done = max([i for i, s in enumerate(sources) if s[2]], default=0)
    keep = set()
    for _, df, _ in sources[last_done:]:
        keep |= set(df['school'])
    # (stress test, 2026-10-24) a school Hein renamed while a school-by-school pass is unfinished ("Brigham Young
    # University" -> "Brigham Young University Law School") was on the site twice, the old name keeping people who had
    # left: a new name whose people are mostly (80%+) one old school's, and that old name not reached under its own
    # name by the unfinished pass, replaces it
    later = [d for _, d, _ in sources[last_done + 1:]]
    if later and sources:
        later = pd.concat(later, ignore_index=True)
        key = lambda links: {hp.norm_form(hp.search_name(l)) for l in links}
        before = {sch: key(g['link']) for sch, g in sources[last_done][1].groupby('school')}
        reached = set(later['school'])
        for new_name, g in later.groupby('school'):
            if new_name in before:
                continue
            ppl = key(g['link'])
            if len(ppl) < 3:
                continue
            old_name, overlap = max(((o, len(ppl & p)) for o, p in before.items()), key=lambda t: t[1], default=(None, 0))
            if old_name and old_name not in reached and overlap >= 0.8 * len(ppl):
                keep.discard(old_name)
                print(f'  school renamed on Hein: "{old_name}" -> "{new_name}" ({overlap} of {len(ppl)} people the same)')
    newest = {}
    for run, df, _ in sources:
        for school in df['school'].unique():
            newest[school] = run
    frames = []
    for run, df, _ in sources:
        mine = [s for s, r in newest.items() if r == run and s in keep]
        part = df[df['school'].isin(mine)].copy()
        part['run'] = run
        frames.append(part)
    df = pd.concat(frames, ignore_index=True)
    df = apply_faculty_edits(df)
    # 2026-10-23 (stress test t15): a crash between a school's rows and its progress line writes them twice
    df = df.drop_duplicates(['school', 'link']).reset_index(drop=True)
    # PATCH 16 (review, 2026-10-24): one person listed twice at one school under two spellings (a faculty/edits.csv
    # "add" of someone Hein already lists, or Hein listing "Smith, John A" and "Smith, John A.") is one person: two
    # listings made two people with the same papers, counted twice in the school's total. Hein's listing is kept.
    same = df['link'].map(parse_hein_name)
    dup = pd.Series(list(zip(df['school'], same)), index=df.index).duplicated()
    if dup.any():
        print(f'  {int(dup.sum())} second listings of a person at the same school (another spelling) dropped:',
              df.loc[dup, 'author'].tolist()[:10])
        df = df[~dup].reset_index(drop=True)

    parsed = df['link'].map(roster_parse)
    n_fixed = int((~df['link'].map(lambda u: ',' in unquote(parse_qs(urlparse(str(u)).query).get('search_name', [''])[0]))).sum())
    if n_fixed:
        print(f'  {n_fixed} faculty-list entries without a comma, read in natural order (or the period as the comma)')
    df['last'] = parsed.map(lambda p: p[0])
    df['first'] = parsed.map(lambda p: p[1])
    df['middle'] = parsed.map(lambda p: p[2])
    # 2026-10-23 (stress test t9 g): a person who moved shows up at the old school (an older list) and the new one
    # (a newer list, e.g. a run in progress); only the newest list that names them counts. People listed at two
    # schools in the same list (joint appointments) keep both.
    # (review, 2026-10-23) An older listing is kept when that older list also named the person at the school where the
    # newer list has them: a joint appointment, not a move (while a faculty run is unfinished, the other school may
    # simply not have been reached yet).
    order = {run: i for i, (run, _, _) in enumerate(sources)}
    # rows added by faculty/edits.csv are always kept and take no part in this (an added joint appointment must
    # not knock out the person's Hein listing elsewhere)
    order['faculty/edits.csv'] = -1
    df['_run'] = df['run'].map(order)
    person = list(zip(df['last'], df['first'], df['middle']))
    df['_person'] = person
    newest_run = df.groupby('_person')['_run'].transform('max')
    newest_schools = df[df['_run'] == newest_run].groupby('_person')['school'].agg(set)
    listed = {}
    for src, sdf, _ in sources:            # every school each source list names each person at
        p = sdf['link'].map(parse_hein_name)
        for key, school in zip(p, sdf['school']):
            listed.setdefault((src, key), set()).add(school)
    keep_mask = [run_i == newest_i or run_i == -1 or bool(listed.get((run, who), set()) & newest_schools[who])
                 for run, run_i, newest_i, who in zip(df['run'], df['_run'], newest_run, df['_person'])]
    moved = int(len(df) - sum(keep_mask))
    if moved:
        print(f'  {moved} faculty listings dropped: the person is on a newer list at another school')
    df = df[keep_mask].drop(columns=['_run', '_person']).reset_index(drop=True)
    df['hein_name'] = df['link'].map(lambda u: unquote(parse_qs(urlparse(str(u)).query).get('search_name', [''])[0]).strip())
    stamped = pd.to_datetime(df[js.COLLECTED_AT], errors='coerce') if js.COLLECTED_AT in df.columns else pd.Series(pd.NaT, index=df.index)
    from_link = pd.to_datetime(df['link'].str.extract(r'1==(\d{10})')[0].astype(float), unit='s')
    df['collected'] = stamped.fillna(from_link)
    print('  faculty lists:', ', '.join(f'{r} ({n} people)' for r, n in df['run'].value_counts().sort_index().items()))
    return df


def load_rankings():
    found = {}
    for f in glob.glob(os.path.join(SOURCE_DIR, 'rankings_*.csv')):
        m = re.fullmatch(r'rankings_(\d{4})\.csv', os.path.basename(f))
        if m:
            found[int(m.group(1))] = f
    year = max(found)
    df = pd.read_csv(found[year])
    # (2026-10-24, "all data possible") journals W&L no longer lists keep the categories of the newest older edition
    # that has them, unranked: our data on them stays on the site (Harvard BlackLetter Law Journal, Harvard
    # Negotiation Law Review, Boston College Law Review E. Supp.)
    for older in sorted(found, reverse=True)[1:]:
        old = pd.read_csv(found[older])
        old = old[~old['journal'].isin(set(df['journal']))].copy()
        if len(old):
            old['score'], old['WandL_rank'] = 'NR', 'NR'
            df = pd.concat([df, old], ignore_index=True)
    df['score'] = pd.to_numeric(df['score'], errors='coerce')   # "NR" -> NaN
    df['WandL_rank'] = pd.to_numeric(df['WandL_rank'], errors='coerce')
    return year, df, datetime.fromtimestamp(os.path.getmtime(found[year]))


def load_usnews():
    '''(edition, source, {US News name: rank label}) from the newest usnews_<edition>.csv in the data folder.
    Written by update_usnews() (TaxProf Blog) or usnews_manual.py (a US News page saved by hand); within an
    edition the hand-saved page wins. TaxProf lists ranked schools only, so "Unranked" schools are carried over
    from the newest hand-saved page. Names TaxProf uses that aren't in taxprof_aliases.csv are skipped.'''
    by_edition, manual = defaultdict(dict), {}
    for f in glob.glob(os.path.join(SOURCE_DIR, 'usnews_*.csv')):
        m = re.fullmatch(r'usnews_(\d{4})-(\d{4})(_manual)?\.csv', os.path.basename(f))
        if m:
            kind = 'manual' if m.group(3) else 'taxprof'
            by_edition[f'{m.group(1)}-{m.group(2)}'][kind] = f
            if kind == 'manual':
                manual[f'{m.group(1)}-{m.group(2)}'] = f
    label = lambda t: (lambda x: x if re.fullmatch(r'\d+(\s*[-–]\s*\d+)?', x) else None)(str(t).strip().lstrip('#').strip())
    for edition in sorted(by_edition, reverse=True):
        kind = 'manual' if 'manual' in by_edition[edition] else 'taxprof'
        df = pd.read_csv(by_edition[edition][kind], dtype=str).fillna('')
        if 'matched' in df.columns:
            bad = df[df['matched'] != 'alias']
            if len(bad):
                print(f'  !! {len(bad)} TaxProf names not in taxprof_aliases.csv, skipped:', bad['source_school'].tolist()[:10])
            df = df[df['matched'] == 'alias']
        if len(df) < 150:
            print(f'  !! only {len(df)} usable schools in the {edition} US News list; trying an older edition')
            continue
        col = 'usnews_rank_text' if 'usnews_rank_text' in df.columns else 'rank_text'
        out = {r['school']: label(r[col]) for _, r in df.iterrows()}
        # 2026-10-25: the same TaxProf post's peer-reputation ranks (deans and faculty, 1-5), where saved
        peer = {r['school']: label(r['peer_rank']) for _, r in df.iterrows()} if 'peer_rank' in df.columns else {}
        peer = {k: v for k, v in peer.items() if v}
        if kind == 'taxprof' and manual:
            prev = pd.read_csv(manual[max(manual)], dtype=str).fillna('')
            for _, r in prev[prev['rank_text'] == 'Unranked'].iterrows():
                out.setdefault(r['school'], None)
        # 2026-10-23 (stress test): a school in the previous edition but not in this one (a TaxProf name not in
        # taxprof_aliases.csv, a school US News skipped) keeps its previous rank instead of dropping off the site
        older = [e for e in by_edition if e < edition]
        if older:
            e = max(older)
            k = 'manual' if 'manual' in by_edition[e] else 'taxprof'
            prev = pd.read_csv(by_edition[e][k], dtype=str).fillna('')
            if 'matched' in prev.columns:
                prev = prev[prev['matched'] == 'alias']
            pcol = 'usnews_rank_text' if 'usnews_rank_text' in prev.columns else 'rank_text'
            carried = [r['school'] for _, r in prev.iterrows() if r['school'] not in out]
            for _, r in prev.iterrows():
                out.setdefault(r['school'], label(r[pcol]))
            if carried:
                print(f'  {len(carried)} schools not in the {edition} US News list kept from {e}:', carried[:10])
        source = f'US News {edition}' + (' (via TaxProf Blog)' if kind == 'taxprof' else ' (saved page)')
        return edition, source, out, peer
    return None


def load_us_schools(roster_schools):
    '''roster school name -> (US News name, US News rank) for US law schools; plus where the list came from'''
    def norm(s):
        s = s.lower().replace('&', 'and')
        s = re.sub(r'\(.*?\)', '', s)
        s = s.replace('--', ' ').replace('-', ' ')
        s = re.sub(r'\b(the|school of law|law school|law center|college of law|at|in)\b', ' ', s)
        s = re.sub(r'[^a-z0-9 ]', '', s)
        return re.sub(r'\s+', ' ', s).strip()

    found = load_usnews()
    if found:
        edition, source, table, peer = found
    else:
        # nothing from update_usnews() yet: the hand-saved page this project started with
        edition, source, table, peer = '2025-2026', 'US News 2025-2026 (saved page)', {}, {}
        soup = BeautifulSoup(open(os.path.join(SOURCE_DIR, '2025_USnews.txt'), encoding='utf-8').read(), 'html.parser')
        for div in soup.find_all('div', attrs={'name': True}):
            rank_tag = div.find('strong', string=lambda s: s and '#' in s)
            table[div.get('name').strip()] = rank_tag.get_text(strip=True).replace('#', '') if rank_tag else None

    by_norm = defaultdict(list)
    for s in roster_schools:
        by_norm[norm(s)].append(s)
    to_ret = {}
    for us_name, rank in table.items():
        n = norm(USNEWS_TO_HEIN.get(us_name, us_name))
        hits = by_norm.get(n)
        if not hits:
            # "University of Michigan--Ann Arbor" vs "University of Michigan"
            prefixes = [k for k in by_norm if n.startswith(k + ' ')]
            hits = by_norm[prefixes[0]] if len(prefixes) == 1 else []
        for h in hits:
            to_ret.setdefault(h, (us_name, rank, peer.get(us_name)))
    unmatched = [n for n in table if not any(v[0] == n for v in to_ret.values())]
    if unmatched:
        print(f'  {len(unmatched)} {source} schools not on Hein\'s faculty lists:', unmatched[:8])
    return to_ret, {'edition': edition, 'source': source, 'schools': len(to_ret), 'peer': bool(peer)}, table, peer


def rank_number(label):
    '''"14" -> 14, "175-194" -> 175, None / "Unranked" -> 0'''
    m = re.match(r'\d+', str(label or ''))
    return int(m.group()) if m else 0


def load_flagship(general_journals, usnews, peer=None):
    '''journal -> [US News rank number (0 = unranked, -1 = not a main law review), [school, rank label, kind,
    parent journal], peer-reputation rank number] for every W&L General journal, from FLAGSHIP_FILE and the US News
    list in use'''
    peer = peer or {}
    df = pd.read_csv(FLAGSHIP_FILE, dtype=str).fillna('')
    rows = {r['journal']: r for _, r in df.iterrows()}
    out = {}
    for j in general_journals:
        r = rows.get(j)
        if r is None:
            print('  !! W&L General journal not in flagship_schools.csv, counted with the other general journals:', j)
            out[j] = [-1, ['', '', 'unmapped', ''], -1]
            continue
        school, kind = r['host_school_usnews_name'], r['kind']
        if kind != 'main':
            out[j] = [-1, [school, '', kind, r.get('parent_journal', '')], -1]
            continue
        if school and school not in usnews:
            print(f'  !! {j}: school "{school}" is not in the US News list in use; counted as unranked')
        label = usnews.get(school)          # "14", "175-194", or None (Unranked)
        out[j] = [rank_number(label), [school, label or 'Unranked', kind, ''], rank_number(peer.get(school))]
    return out


def school_norm(s):
    '''loose school-name key shared by the US News and ABA matching'''
    s = s.lower().replace('&', 'and')
    s = re.sub(r'\(.*?\)', '', s)
    s = s.replace('--', ' ').replace('-', ' ').replace('/', ' ')
    s = re.sub(r"[’']", '', s)
    s = re.sub(r'\b(the|school of law|law school|law center|college of law|at|in|of|university|college|school|law|center)\b', ' ', s)
    s = re.sub(r'[^a-z0-9 ]', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def load_aba(roster_schools):
    '''ABA-approved law schools (newest aba_schools_<year>.csv in the data folder) matched to
    the schools on Hein's faculty lists: (roster school -> ABA name, check results for meta.json). The check is the
    point: every ABA-approved school should be on Hein's faculty lists, or the site is missing a school.'''
    files = sorted(glob.glob(os.path.join(SOURCE_DIR, 'aba_schools_[0-9][0-9][0-9][0-9].csv')))
    if not files:
        print('  !! no aba_schools_<year>.csv yet; skipping the ABA school check')
        return {}, None
    year = int(re.search(r'(\d{4})\.csv$', files[-1]).group(1))
    aba = pd.read_csv(files[-1], dtype=str)['aba_name'].tolist()
    aliases = dict(pd.read_csv(os.path.join(SOURCE_DIR, 'aba_aliases.csv'), dtype=str).itertuples(index=False))
    uninvert = lambda n: (lambda m: f'{m.group(2)} {m.group(1)} {m.group(3)}' if m else n)(
        re.match(r'^(.*?),\s*(THE UNIVERSITY OF|UNIVERSITY OF|THE)\s*(.*)$', n.strip()))
    by_norm = defaultdict(list)
    for s in roster_schools:
        by_norm[school_norm(s)].append(s)
    to_ret, missing = {}, []
    for name in aba:
        if name in aliases:
            hits = [aliases[name]] if aliases[name] in set(roster_schools) else []
        else:
            hits = by_norm.get(school_norm(uninvert(name)), [])
        if len(hits) == 1 and hits[0] not in to_ret:
            to_ret[hits[0]] = name
        else:
            missing.append(name)
    if missing:
        print(f'  !! {len(missing)} ABA-approved schools ({year}) not found on Hein\'s faculty lists '
              f'(add a line to aba_aliases.csv in the data folder if Hein uses another name):', missing)
    return to_ret, {'year': year, 'schools': len(aba), 'on_hein': len(to_ret), 'missing': missing}


################################################ build

def load_aliases(roster):
    '''faculty/edits.csv "alias": another Hein spelling for a faculty member (e.g. "Williams, Robert F." for the Rutgers
    "Williams, Robert"); papers under that spelling go to that person. Parsed name -> roster rows.'''
    full = defaultdict(list)
    for i, key in enumerate(zip(roster['last'], roster['first'], roster['middle'])):
        full[key].append(roster.index[i])
    alias = {}
    edits = load_faculty_edits()
    for r in edits[edits['action'] == 'alias'].itertuples():
        target = parse_hein_name(hein_profile_link(r.name))
        hits = [i for i in full.get(target, []) if not r.school or roster.at[i, 'school'] == r.school]
        if hits:
            alias[parse_hein_name(hein_profile_link(r.hein_name))] = hits
        else:
            print(f'  !! faculty/edits.csv alias {r.hein_name!r} -> {r.name!r}: no such person on the lists')
    return alias


def non_school_links(papers, non_school):
    '''(audit, 2026-10-25) the author links with papers in the `non_school` journals, and those with papers only there'''
    if not len(non_school):
        return set(), set()
    inside = papers['journal'].isin(non_school)
    some = set(papers.loc[inside, 'author'])
    return some, some - set(papers.loc[~inside, 'author'])


def match_by_name(papers, roster, rows=None, non_school=frozenset(), journal_schools=None):
    '''the name rules: paper author link -> roster row indexes (a person listed at two schools gets both), using only
    the roster rows `rows` (default: all). Also returns counts, how each link was decided, and the roster rows each
    uncertain decision involved (credited on a differing name, or held back as unsure). journal_schools: journal ->
    the faculty-list schools that publish it, the evidence some second-pass rules need (none: those rules are off).'''
    # (audit, 2026-10-25) the owner wants "authors (profs) at institutions". Journals that are not a school's
    # (flagship_schools.csv kind "non_school": the ABA Journal, the Green Bag, Practical Lawyer ...) also carry
    # staff writers and practitioners, and the ABA Journal's writer "Davis, Kevin" (no middle initial) was credited to
    # NYU's Kevin E. Davis as the only Kevin Davis on the lists: 45 pieces. In those journals an author with no middle
    # initial is not credited to a faculty member listed with one: a spelling found only there is middle_unsure here;
    # one also found in school journals is credited, and match_authors / build() leave out its non-school papers.
    _, only_non_school = non_school_links(papers, non_school)
    full = defaultdict(list)
    short = defaultdict(list)
    no_suffix = defaultdict(list)
    untagged = defaultdict(list)        # (surname without tag or suffix, first) -> roster rows
    for i, r in roster.iterrows():
        if rows is not None and i not in rows:
            continue
        full[(r['last'], r['first'], r['middle'])].append(i)
        short[(r['last'], r['first'])].append(i)
        no_suffix[(r['last'].split('|')[0], r['first'])].append(i)
        untagged[(split_last(r['last'])[0], r['first'])].append(i)

    to_ret, how_of = {}, {}
    stats = defaultdict(int)
    unsure_rows = defaultdict(set)      # roster row -> links it was an uncertain candidate for
    # (math check, 2026-10-23) the middle initials Hein's paper authors use for each first + last name: a faculty
    # member listed with no middle name ("Smith, Michael") must not absorb "Smith, Michael S." and "Smith, Michael D."
    # Counted in papers: when one initial has 85%+ of them, that is the faculty member and the rest are strays or
    # namesakes; with no dominant initial, several people share the name and none is credited automatically.
    rows_per_link = papers.groupby('author').size()
    paper_mids = defaultdict(lambda: defaultdict(int))
    for link in papers['author'].unique():
        l, f, m = parse_hein_name(link)
        base, tag, _ = split_last(l)
        if tag:
            # (naming audit) a namesake Hein tags is another person under the same name: counted, as "#", so the
            # untagged name is not taken for one person ("Kaye, David (I)" keeps "Kaye, David H." from dominating)
            paper_mids[(base, f)]['#'] += int(rows_per_link[link])
        elif m:
            paper_mids[(l.split('|')[0], f)][m[0]] += int(rows_per_link[link])

    def dominant_initial(last, first):
        counts = paper_mids.get((last.split('|')[0], first), {})
        if not counts:
            return None
        top = max(counts, key=counts.get)
        return top if counts[top] >= 0.85 * sum(counts.values()) else None

    def decide(link, how, hits=None, unsure=()):
        stats[how] += 1
        how_of[link] = how
        if hits:
            to_ret[link] = hits
        for i in unsure:
            unsure_rows[i].add(link)

    for link in papers['author'].unique():
        last, first, middle = parse_hein_name(link)
        if (last, first, middle) in full:
            hits = full[(last, first, middle)]
            if not middle and all(joined_prefix(raw_last(link), raw_last(roster.at[i, 'link'])) for i in hits):
                decide(link, 'joined_name_unsure', unsure=hits)      # "d'Avis, Ronald" vs "Davis, Ronald" (review)
            else:
                decide(link, 'exact', hits)
            continue
        # match on first + last and ignore the middle name (Mayer, Connie vs Mayer, Connie Marlene),
        # but only when the first + last is one person and the middle initials don't conflict
        cands = [i for i in short.get((last, first), []) if middles_compatible(middle, roster.at[i, 'middle'])]
        people = {(roster.at[i, 'last'], roster.at[i, 'first'], roster.at[i, 'middle']) for i in cands}
        how = 'first_last'
        if not people:
            # a paper that adds or leaves off "Jr." etc.: only when the name without it is one person
            cands = [i for i in no_suffix.get((last.split('|')[0], first), []) if middles_compatible(middle, roster.at[i, 'middle'])
                     and ('|' not in last or '|' not in roster.at[i, 'last'])]   # Jr. vs III are two people (review)
            people = {(roster.at[i, 'last'], roster.at[i, 'first'], roster.at[i, 'middle']) for i in cands}
            how = 'suffix_differs'
        roster_mid = next(iter(people))[2] if len(people) == 1 else ''
        if len(people) == 1 and middle and not roster_mid and middle[0] != dominant_initial(last, first):
            # the faculty list gives no middle name and this paper's middle initial is not the one that dominates
            # this first + last name on Hein: a namesake (or several people), not credited automatically (math check)
            decide(link, 'middle_unsure', unsure=cands)
        elif len(people) == 1 and not middle and all(joined_prefix(raw_last(link), raw_last(roster.at[i, 'link'])) for i in cands):
            # 2026-10-23 (math check): the names only meet once a one-letter prefix is joined on ("d'Avis, Ronald"
            # vs "Davis, Ronald B.") and the paper gives no middle initial: too weak to credit automatically.
            # Longer joins are kept ("An-Na'im" = "An-Naim", "Du Bose" = "Dubose").
            decide(link, 'joined_name_unsure', unsure=cands)
        elif len(people) == 1 and not middle and roster_mid and link in only_non_school:
            # (audit, 2026-10-25) every paper under this spelling is in a non-school journal: none is credited
            decide(link, 'middle_unsure', unsure=cands)
        elif len(people) == 1:
            decide(link, how, cands, unsure=cands)
        elif len(people) > 1:
            decide(link, 'ambiguous', unsure=cands)
        else:
            # (naming audit) the names meet only once Hein's namesake tag is set aside (a tagged paper, or a tagged
            # listing): held back, for a faculty/edits.csv alias when it is the same person ("Cohen, David S. (I)")
            base, tag, _ = split_last(last)
            near = [i for i in untagged.get((base, first), []) if middles_compatible(middle, roster.at[i, 'middle'])
                    and (tag or split_last(roster.at[i, 'last'])[1])]
            if near:
                decide(link, 'tag_unsure', unsure=near)
            else:
                decide(link, 'not_faculty')
    name_variants(papers, roster, rows, to_ret, how_of, stats, unsure_rows, full, short, only_non_school, journal_schools)
    return to_ret, dict(stats), how_of, unsure_rows


def name_variants(papers, roster, rows, to_ret, how_of, stats, unsure_rows, full, short, only_non_school, journal_schools):
    '''(naming audit, 2026-10-26; the owner: "I need author to title and name information to be perfect") a second pass
    of match_by_name over the spellings its rules leave uncredited, for the ways one person's name is written
    differently. Decided per spelling (Hein can have several links for one), each rule credits a spelling only when
    exactly one person on the faculty lists fits it; the guards come from reading every candidate by hand:
      same_words       the same words with the comma elsewhere ("Reiser, Dana Brakman" = "Brakman Reiser, Dana"), or none
                       ("Andrew Koppelman"); namesake tag and suffix equal; 8 letters or more
      initial_name     an initial plus the name the person goes by ("Wright, R. George" = "Wright, Richard George";
                       "Hemphill, C. Scott" = "Hemphill, Scott"; "Capers, Bennett" = "Capers, I. Bennett")
      initials         initials only ("Balkin, J. M." = "Balkin, Jack M."; the listing must have a middle name)
                       (these two only for a spelling with a paper from 1985 on: older ones were namesakes, e.g.
                       "White, A. A." 1952-75 and "Holland, R. Paul" 1930)
      no_comma         a string that lost its comma, read both ways ("Talley Eric L.", "Moran. Rachel F."): exactly one
                       reading finds exactly one person
      honorific        a title before the given name ("Diller, Dean Matthew", "O'Scannlain, Hon. Diarmuid F."; "Dean"
                       only before a full word, so "Strang, Dean A." keeps its given name)
      goes_by_middle   the middle name as the first ("Outterson, Kevin" = "Outterson, Michael Kevin"), with evidence; a
                       middle initial on the paper must be the listing's first initial ("Smith, Douglas G." is not
                       "Smith, Steven Douglas")
      nickname         "Schragger, Rich" = "Schragger, Richard C.", with evidence; not when someone on the lists has
                       the paper's own first name
      middle_evidence  a middle initial the listing lacks (held back above as middle_unsure), with evidence, 2+ papers
                       or a shared co-author, a paper from 1985 on, and one middle initial per person
    Evidence: a paper under the spelling in a journal the person's own school publishes, or a co-author shared with
    the person's papers already credited. Spellings found only in non-school journals are left alone.'''
    links = papers['author'].unique()
    parsed = {l: parse_hein_name(l) for l in links}
    y1 = papers.groupby('author')['year'].max()
    y0 = papers.groupby('author')['year'].min()
    firsts = defaultdict(set)       # surname -> the first names written with it: a common surname has many
    for l in links:
        firsts[split_last(parsed[l][0])[0]].add(parsed[l][1])
    search_name = lambda l: unquote(parse_qs(urlparse(str(l)).query).get('search_name', [''])[0]).strip()
    n_papers = papers.groupby('author')['paper_key'].nunique()
    n_rows = papers.groupby('author').size()
    journals_of = papers.groupby('author')['journal'].agg(set)
    pkeys_of = papers.groupby('author')['paper_key'].agg(set)
    authors_of = papers.groupby('paper_key')['author'].agg(list)
    spellings = defaultdict(list)
    for l in links:
        spellings[parsed[l]].append(l)
    ident_rows = defaultdict(list)
    for i, r in roster.iterrows():
        if rows is None or i in rows:
            ident_rows[(r['last'], r['first'], r['middle'])].append(i)
    ident_of = {i: ident for ident, rs in ident_rows.items() for i in rs}
    by_surname = defaultdict(list)
    words_ix = defaultdict(set)
    for ident in ident_rows:
        base, tag, suf = split_last(ident[0])
        by_surname[(base, tag)].append(ident)
        words_ix[(ident[1] + ident[2].replace(' ', '') + base, tag, suf)].add(ident)
    schools_of = {ident: {roster.at[i, 'school'] for i in rs} for ident, rs in ident_rows.items()}
    credited_links = defaultdict(set)
    for link, hits in to_ret.items():
        for i in hits:
            if i in ident_of:
                credited_links[ident_of[i]].add(link)

    def coauthors(ls, own):
        out = set()
        for l in ls:
            for pk in pkeys_of.get(l, ()):
                out.update(split_last(parsed[a][0])[0] for a in authors_of[pk] if a not in ls)
        return out - {own, ''}

    def evidence(ls, ident):
        if not journal_schools:
            return False, False
        home = any(journal_schools.get(j, set()) & schools_of[ident] for l in ls for j in journals_of.get(l, ()))
        own = split_last(ident[0])[0]
        co = bool(coauthors(ls, own) & coauthors(credited_links.get(ident, ()), own))
        return home, co

    def career_ok(newest, ident):
        '''a spelling whose newest paper is more than ten years older than the person's first credited paper is
        another, older person ("Ball, David W." 1987-92 is not Santa Clara's W. David Ball)'''
        ys = [int(y0.get(l, 9999)) for l in credited_links.get(ident, ())]
        return newest >= 1985 and (not ys or newest >= min(ys) - 10)

    def suffix_ok(ps, rs):
        return not ps or not rs or ps == rs

    def lookup(last, first, middle):
        '''the one person an exact or first + last match finds (the rules above, without their guards), else None'''
        hits = full.get((last, first, middle)) or [i for i in short.get((last, first), []) if middles_compatible(middle, roster.at[i, 'middle'])]
        ids = {ident_of[i] for i in hits if i in ident_of}
        return next(iter(ids)) if len(ids) == 1 else None

    proposals = defaultdict(set)    # spelling -> {(person, rule)}
    for key, ls in spellings.items():
        open_ls = [l for l in ls if how_of.get(l) == 'not_faculty' and l not in only_non_school]
        if not open_ls:
            continue
        last, first, middle = key
        base, tag, suf = split_last(last)
        P = [first] + middle.split() if first else []
        newest = max(int(y1.get(l, 0)) for l in ls)
        found = []
        # same words, comma elsewhere (or none)
        wk = (first + middle.replace(' ', '') + base, tag, suf)
        if len(wk[0]) >= 8 and len(words_ix.get(wk, ())) == 1:
            found.append((next(iter(words_ix[wk])), 'same_words'))
        # a string with no comma: both readings
        raw = unquote(parse_qs(urlparse(str(ls[0])).query).get('search_name', [''])[0]).strip()
        if raw and ',' not in raw and len(raw.split()) >= 2 and not re.search(r'[\d:]', raw):
            m = re.match(r'^([^\s.]+)\.\s+(.+)$', raw)
            toks = raw.split()
            readings = [m.group(1) + ', ' + m.group(2)] if m else [toks[0] + ', ' + ' '.join(toks[1:]), toks[-1] + ', ' + ' '.join(toks[:-1])]
            hit = {lookup(*parse_hein_name(hein_profile_link(r))) for r in readings} - {None}
            if len(hit) == 1:
                found.append((next(iter(hit)), 'no_comma'))
        if P and P[0] in HONORIFICS | {'chief', 'dean'}:
            rest = P[2:] if P[0] == 'chief' and len(P) > 2 and P[1] in ('judge', 'justice') else P[1:]
            if rest and len(rest[0]) > 1:                # "Dean A." keeps Dean as the given name
                who = lookup(last, rest[0], ' '.join(rest[1:]))
                # a judge's title only for someone listed at a court ("Henry, Justice John S." is not Loyola
                # Marymount's John Henry)
                if who and (P[0] not in BENCH or any(re.search(r'court|circuit|judicial', sc, re.I) for sc in schools_of[who])):
                    found.append((who, 'honorific'))
        if P:
            fits = defaultdict(set)
            for ident in by_surname.get((base, tag), []):
                rbase, rtag, rsuf = split_last(ident[0])
                if not suffix_ok(suf, rsuf):
                    continue
                R = [ident[1]] + ident[2].split()
                if R == P:
                    continue
                # an initial plus the name the person goes by
                if (len(P[0]) == 1 and len(P) > 1 and len(P[1]) > 1 and len(R) > 1 and len(R[0]) > 1 and R[0][0] == P[0]
                        and R[1] == P[1] and middles_compatible(' '.join(P[2:]), ' '.join(R[2:]))):
                    fits['initial_name'].add(ident)          # "R. George" / "Richard George"
                if (len(R[0]) == 1 and len(R) > 1 and len(R[1]) > 1 and len(P[0]) > 1 and P[0] == R[1]
                        and (len(P) == 1 or P[1][0] == R[0])):
                    fits['initial_name_dropped'].add(ident)  # "Bennett" / "I. Bennett"; "Tiffany C." / "C. Tiffany"
                if (len(P[0]) == 1 and len(P) > 1 and len(P[1]) > 1 and P[1] == R[0]
                        and (len(R) == 1 or R[1][0] == P[0])):
                    fits['initial_name_dropped'].add(ident)  # "C. Scott" / "Scott"
                # initials only
                if (len(P[0]) == 1 and len(P) > 1 and all(len(t) == 1 for t in P[1:]) and len(R[0]) > 1 and len(R) > 1
                        and R[0][0] == P[0] and all(a == b[0] for a, b in zip(P[1:], R[1:])) and (not suf or suf == rsuf)):
                    fits['initials'].add(ident)
                # the middle name as the first
                if (len(P[0]) > 1 and len(R) > 1 and len(R[0]) > 1 and len(R[1]) > 1 and P[0] == R[1]
                        and (len(P) == 1 or P[1][0] == R[0][0])):
                    fits['goes_by_middle'].add(ident)
                # a nickname
                if len(P[0]) > 1 and R[0] in NICK_OF.get(P[0], ()) and middles_compatible(middle, ident[2]):
                    fits['nickname'].add(ident)
            # an initial one side leaves off is weaker than one both give: with a common surname (Smith, Clark,
            # Mitchell: more than COMMON_SURNAME first names written with it) it needs evidence too ("Smith, Gregory" is not LSU's
            # N. Gregory Smith on its own)
            dropped = fits.pop('initial_name_dropped', set())
            if len(fits['initial_name'] | dropped) == 1:
                who = next(iter(fits['initial_name'] | dropped))
                if who in fits['initial_name'] or len(firsts.get(base, ())) <= COMMON_SURNAME or any(evidence(ls, who)):
                    fits['initial_name'] = {who}
                else:
                    fits['initial_name'] = set()
            for rule in ('initial_name', 'initials'):
                if len(fits[rule]) == 1 and career_ok(newest, next(iter(fits[rule]))):
                    found.append((next(iter(fits[rule])), rule))
            own_first = any(i[1] == first for i in by_surname.get((base, tag), []))
            for rule in ('goes_by_middle', 'nickname'):
                if len(fits[rule]) == 1 and not (rule == 'nickname' and own_first):
                    who = next(iter(fits[rule]))
                    home, co = evidence(ls, who)
                    if home or co:
                        found.append((who, rule))
        people = {w for w, _ in found}
        if len(people) == 1 and not any((search_name(l), roster.at[i, 'hein_name'].strip(), roster.at[i, 'school']) in KNOWN_NAMESAKES
                                        for l in ls for i in ident_rows[found[0][0]]):
            proposals[key] = found[0]
    # a middle initial the listing lacks, with evidence (one initial per person: the one with the most rows)
    mids = defaultdict(list)
    rows_of_link = defaultdict(set)
    for i, ls in unsure_rows.items():
        for l in ls:
            rows_of_link[l].add(i)
    for key, ls in spellings.items():
        open_ls = [l for l in ls if how_of.get(l) == 'middle_unsure' and l not in only_non_school]
        if not open_ls or not key[2]:
            continue
        rows_u = set().union(*(rows_of_link[l] for l in open_ls))
        ids = {ident_of[i] for i in rows_u if i in ident_of}
        if len(ids) != 1:
            continue
        who = next(iter(ids))
        if max(int(y1.get(l, 0)) for l in ls) < 1985:
            continue
        home, co = evidence(ls, who)
        if (home or co) and (sum(int(n_papers.get(l, 0)) for l in ls) >= 2 or co):
            mids[who].append((sum(int(n_rows.get(l, 0)) for l in ls), key))
    for who, cands in mids.items():
        best = max(cands)[1][2][0]
        for _, key in cands:
            if key[2][0] == best and key not in proposals and not any(
                    (search_name(l), roster.at[i, 'hein_name'].strip(), roster.at[i, 'school']) in KNOWN_NAMESAKES
                    for l in spellings[key] for i in ident_rows[who]):
                proposals[key] = (who, 'middle_evidence')
    added = defaultdict(int)
    for key, (who, rule) in proposals.items():
        old = 'middle_unsure' if rule == 'middle_evidence' else 'not_faculty'
        for l in spellings[key]:
            if how_of.get(l) != old or l in only_non_school:
                continue
            stats[old] -= 1
            stats[rule] += 1
            how_of[l] = rule
            to_ret[l] = list(ident_rows[who])
            for i in ident_rows[who]:
                unsure_rows[i].add(l)
            added[rule] += 1
    if added:
        print('  name variants credited (second pass, by rule; author spellings):', dict(added))



def same_school(a, b):
    """two names of one school, as Hein writes them on profiles and school lists ("Brigham Young University" /
    "Brigham Young University Law School")"""
    return bool(a) and bool(b) and (a == b or school_norm(a) == school_norm(b))


# PATCH 20 (2026-10-25, the owner: "stop using the saved profile spellings so every faculty member is matched by name
# only"): the Hein profile metadata read before the profile phase was stopped (116 faculty) stays in hein_profiles/
# but decides nothing; with no profiles, match_authors gives exactly the name rules' decisions (and edits.csv aliases)
USE_PROFILE_METADATA = False


def match_authors(papers, roster, non_school=frozenset(), journal_schools=None):
    """paper author link -> roster row indexes (a person listed at two schools gets both). `non_school`: the journals
    flagship_schools.csv marks "non_school" (see match_by_name).

    2026-10-24 (the owner: "the name match should come from hein url. we can use the way they resolved to figure out
    how we should resolve it ... one author should have one URL reference"): one faculty member = one Hein profile
    link (search_name). Where we have that profile's metadata (hein_profiles.py), Hein's own set of name forms for the
    person decides: a paper is theirs when its author form is in the set, and the name rules no longer give them papers.
    Faculty without profile metadata are matched by the name rules (match_by_name), as before. (2026-10-25: profile
    metadata is no longer collected or used (PATCH 20, USE_PROFILE_METADATA): everyone is matched by the name rules.)

    PATCH 16 (independent review, 2026-10-24):
    - a profile whose affiliation is none of the listing's schools is not used for that listing: Hein's "Smith,
      Michael" at St. Mary's opens the profile of a Baylor lecturer, whose name set would take papers away from the
      real owner (a move the faculty lists have not caught up with yet is matched by the name rules meanwhile)
    - faculty without a profile keep the name rules' decision over the whole roster (a namesake held back as
      ambiguous stays held back when one of the namesakes is profiled), minus the profiled people
    - an unprofiled person's own exact name is theirs (it was lost to a profiled person's punctuation twin)
    - the punctuation rule keeps the one-letter-particle guard ("d'Avis" vs "Davis" with no middle initial)
    - a spelling the name rules give a profiled person but their profile does not list is recorded in
      hein_profiles/unexplained.json, so the next update refreshes that profile (HeinOnline adds new spellings)"""
    profiles = hp.load_good() if USE_PROFILE_METADATA else {}
    pk = roster['link'].map(lambda l: hp.norm_form(hp.search_name(l)))
    rows_of = defaultdict(list)
    for i, k in pk.items():
        rows_of[k].append(i)
    usable, mismatched = {}, {}
    for k, idx in rows_of.items():
        prof = profiles.get(k)
        if not prof:
            continue
        aff = prof.get('affiliation', '')
        if aff and not any(same_school(aff, s) for s in roster.loc[idx, 'school']):
            mismatched[k] = aff
            continue
        usable[k] = prof
    profiled = set(usable)
    owners = defaultdict(set)          # a name form -> the profiled faculty whose Hein profile lists it
    near = defaultdict(set)            # the same, by parsed name (spelling differs only in punctuation, accents, case)
    near_raw = defaultdict(list)       # parsed name -> (person, raw last name of the listed form), for the d'Avis guard
    for k in profiled:
        forms = [f for f in usable[k]['forms']] + [roster.at[rows_of[k][0], 'hein_name']]
        for f in forms:
            owners[hp.norm_form(f)].add(k)
            key = parse_hein_name(hein_profile_link(f))
            near[key].add(k)
            near_raw[key].append((k, raw_last(hein_profile_link(f))))

    alias = load_aliases(roster)
    by_name, name_stats, name_how, unsure_rows = match_by_name(papers, roster, non_school=non_school,   # every faculty member
                                                               journal_schools=journal_schools)
    # the name rules' decisions over the whole roster, without the profiled people (Hein has spoken for them), and
    # without giving a listing the other spellings of the other school's profile its link opens (that profile's
    # person wrote those; the listing's own exact name is still matched by the rules)
    foreign = defaultdict(set)         # listing -> spellings of the other school's profile behind its link
    for k in mismatched:
        foreign[k] = {hp.norm_form(f) for f in profiles[k]['forms']} - {k}
    fallback = {}
    for link, idx in by_name.items():
        x = hp.norm_form(hp.search_name(link))
        keep = [i for i in idx if pk[i] not in profiled and x not in foreign.get(pk[i], ())]
        if keep:
            fallback[link] = keep

    to_ret = {}
    stats = defaultdict(int)
    # (audit, 2026-10-25) the non-school journals rule (see match_by_name) for every way a link is credited but a
    # faculty/edits.csv alias (a person's own correction): Hein's profile for NYU's Kevin E. Davis lists "Davis, Kevin",
    # the ABA Journal writer's spelling, as his. held: links credited in school journals whose non-school papers
    # build() leaves out
    in_non_school, only_non_school = non_school_links(papers, non_school)
    held, kept_out = set(), defaultdict(int)

    def credit(link, rows, how):
        if (link in in_non_school and not parse_hein_name(link)[2]
                and all(roster.at[i, 'middle'] for i in rows)):
            stats['name_rules_middle_unsure'] += 1
            if link in only_non_school:
                kept_out[how] += 1
                return
            held.add(link)            # counted under both decisions
        to_ret[link] = rows
        stats[how] += 1

    for link in papers['author'].unique():
        x = hp.norm_form(hp.search_name(link))
        parsed = parse_hein_name(link)
        if parsed in alias:
            to_ret[link] = alias[parsed]
            stats['alias (faculty/edits.csv)'] += 1
            continue
        claim = set(owners.get(x, ()))
        if claim:
            # a form in two people's profiles: the one whose own profile name it is wins (Hein's page for that
            # name is theirs); otherwise Hein itself is unsure, and neither is credited
            named = {x} if x in claim or x in rows_of else set()
            if len(claim) == 1 and named <= claim:
                credit(link, rows_of[next(iter(claim))], 'hein_profile')
            elif len(named) == 1:
                credit(link, rows_of[next(iter(named))], 'hein_profile_own_name')
            else:
                stats['hein_profiles_share_name'] += 1
            continue
        if x in rows_of and x not in profiled and link in fallback:
            # an unprofiled faculty member's own listed name (review: a profiled person's punctuation twin took it)
            credit(link, fallback[link], 'name_rules_own_name')
            continue
        close = near.get(parsed, set())
        if close:
            # the name Hein lists for them, written with other punctuation ("Huq, A. Z" / "Huq, A.Z."); a faculty
            # member without a profile who has that very name too makes it two people: not credited
            k = sorted(close)[0]
            joined_only = not parsed[2] and all(joined_prefix(raw_last(link), r) for kk, r in near_raw[parsed] if kk == k)
            namesake = link in fallback and name_how.get(link) == 'exact'    # an unprofiled person with this name
            if len(close) == 1 and not namesake and not joined_only:
                credit(link, rows_of[k], 'hein_profile_punctuation')
            elif joined_only:
                stats['joined_name_unsure'] += 1
            else:
                stats['hein_profile_namesakes'] += 1
            continue
        how = name_how.get(link, 'not_faculty')
        if link in fallback:
            credit(link, fallback[link], 'name_rules_' + how)
        elif link in by_name:
            # the name rules' person is profiled and Hein does not list this spelling, or it belongs to the other
            # school's profile behind their link
            stats['not_in_hein_profile'] += 1
        else:
            stats['not_faculty' if how == 'not_faculty' else 'name_rules_' + how] += 1

    # what Hein's profiles changed, against the name rules alone (for the faculty whose profiles we have)
    rows_per_link = papers.groupby('author').size()
    changes = []
    for link in set(by_name) | set(to_ret):
        old = {pk[i] for i in by_name.get(link, [])}
        new = {pk[i] for i in to_ret.get(link, [])}
        for k in (old ^ new) & profiled:
            changes.append({'change': 'added by Hein profile' if k in new else 'dropped (not in Hein profile)',
                            'faculty': roster.at[rows_of[k][0], 'hein_name'],
                            'school': '; '.join(sorted(roster.loc[rows_of[k], 'school'])),
                            'paper_author': hp.search_name(link).strip(), 'name_rule': name_how.get(link, ''),
                            'rows': int(rows_per_link.get(link, 0)), 'link': link, 'person': k})
    agree = sum(1 for link in by_name if {pk[i] for i in by_name[link]} & profiled
                and {pk[i] for i in by_name[link]} == {pk[i] for i in to_ret.get(link, [])})
    if mismatched:
        print(f'  {len(mismatched)} Hein profiles name a school other than the listing\'s (another person\'s page, or a '
              f'move the lists have not caught up with): not used; see hein_profiles/affiliation_check.csv')
    if profiled:
        added = [c for c in changes if c['change'].startswith('added')]
        dropped = [c for c in changes if c['change'].startswith('dropped')]
        print(f'  Hein profile metadata: in for {len(profiled)} of {len(rows_of)} faculty. For them, Hein and the name rules '
              f'agree on {agree} author spellings; Hein adds {len(added)} ({sum(c["rows"] for c in added)} paper rows) '
              f'and drops {len(dropped)} ({sum(c["rows"] for c in dropped)} paper rows)')
        os.makedirs(hp.DIR, exist_ok=True)
        pd.DataFrame(changes, columns=['change', 'faculty', 'school', 'paper_author', 'name_rule', 'rows', 'link', 'person']) \
            .drop(columns=['link', 'person']).sort_values(['change', 'rows'], ascending=[True, False]) \
            .to_csv(os.path.join(hp.DIR, 'changes_from_name_rules.csv'), index=False)
        record_unexplained([c for c in changes if c['change'].startswith('dropped')], papers)
    return to_ret, dict(stats), {'pk': pk, 'rows_of': rows_of, 'profiled': profiled, 'profiles': usable,
                                 'mismatched': mismatched, 'all_profiles': profiles,
                                 'by_name': by_name, 'unsure_rows': unsure_rows, 'held_in_non_school': held}


def record_unexplained(dropped, papers):
    """PATCH 16 (review): spellings the name rules give a profiled person that their profile does not list, with when
    each was first seen (when its earliest row was collected), merged into hein_profiles/unexplained.json. The next update refreshes such a
    profile again RECHECK_DAYS later if the spelling turned up after the profile's metadata was collected; once it has
    been updated again, the same spelling never triggers another update (hein_profiles.due)."""
    if not dropped:
        return
    first = papers.groupby('author')[js.COLLECTED_AT].min() if js.COLLECTED_AT in papers.columns else {}
    now = datetime.now().isoformat(timespec='seconds')
    data = hp.load_unexplained()
    for c in dropped:
        seen = str(first.get(c['link'], '') or '')[:19] if len(first) else ''
        try:
            seen = datetime.fromisoformat(seen).isoformat(timespec='seconds') if seen else now
        except ValueError:
            seen = now
        forms = data.setdefault(c['person'], {})
        form = hp.norm_form(c['paper_author'])
        forms[form] = min(forms.get(form, seen), seen)
    hp.save_unexplained(data)


def write_profile_wants(papers, roster, us_schools, info):
    '''hein_profiles/wanted.txt: every faculty member's Hein search_name, in the order the next update should refresh their
    profiles: US law schools first; within them, people whose matching by name is least certain (credited on a
    spelling that differs from their listing, or held back as unsure), then people with papers, then the rest; more
    paper rows at stake first. Also faculty_runs/priority.txt: US law schools first for the faculty-list pass.'''
    rows_per_link = papers.groupby('author').size()
    stake = defaultdict(int)
    for link, idx in info['by_name'].items():
        for i in idx:
            stake[i] += int(rows_per_link.get(link, 0))
    for i, links in info['unsure_rows'].items():
        stake[i] += sum(int(rows_per_link.get(l, 0)) for l in links)
    credited = {i for idx in info['by_name'].values() for i in idx}
    order = sorted(roster.index, key=lambda i: (roster.at[i, 'school'] not in us_schools,
                                                0 if i in info['unsure_rows'] else 1 if i in credited else 2,
                                                -stake[i], roster.at[i, 'hein_name']))
    os.makedirs(os.path.dirname(FACULTY_PRIORITY), exist_ok=True)
    with open(FACULTY_PRIORITY + '.tmp', 'w', encoding='utf-8') as f:
        f.write('\n'.join(sorted(s for s in roster['school'].unique() if s in us_schools)) + '\n')
    os.replace(FACULTY_PRIORITY + '.tmp', FACULTY_PRIORITY)
    if not USE_PROFILE_METADATA:       # PATCH 20: no profile reads, so no to-do list for them
        return
    names = list(dict.fromkeys(hp.search_name(roster.at[i, 'link']) for i in order))
    os.makedirs(hp.DIR, exist_ok=True)
    with open(hp.WANTED + '.tmp', 'w', encoding='utf-8') as f:
        f.write('\n'.join(n for n in names if n.strip()) + '\n')
    os.replace(hp.WANTED + '.tmp', hp.WANTED)
    todo = hp.due(hp.load(), names)
    print(f'  wrote hein_profiles/wanted.txt: {len(names)} faculty, {len(todo)} without current profile metadata')
    # Hein's profile names another school than the list we have them on: usually a move the faculty-list pass has
    # not reached yet (the list wins until then)
    rows = []
    for k, aff in info['mismatched'].items():      # PATCH 16: these profiles are not used for matching
        schools = set(roster.loc[info['rows_of'][k], 'school'])
        rows.append({'faculty': roster.at[info['rows_of'][k][0], 'hein_name'], 'listed_at': '; '.join(sorted(schools)),
                     'hein_profile_affiliation': aff, 'profile_read': info['all_profiles'][k].get('fetched_at', '')})
    pd.DataFrame(rows, columns=['faculty', 'listed_at', 'hein_profile_affiliation', 'profile_read']) \
        .to_csv(os.path.join(hp.DIR, 'affiliation_check.csv'), index=False)
    if rows:
        print(f'  {len(rows)} faculty whose Hein profile names another school than their list (moved?): '
              f'hein_profiles/affiliation_check.csv')


def write_missing_homepages(roster, info, home_of, school_csv, csv_schools, with_papers):
    """faculty_runs/missing_homepages.csv: everyone on the faculty lists with no homepage yet, for a later fallback
    (inferring the URL, or a search by hand). school_csv_read says whether the build has Hein's CSV for their school
    (no: the next faculty pass will likely fill it in)."""
    rows = []
    for i in roster.index:
        if home_of(i):
            continue
        rec = school_csv.get((roster.at[i, 'school'], info['pk'][i]), {})
        rows.append({'hein_name': roster.at[i, 'hein_name'], 'school': roster.at[i, 'school'],
                     'school_csv_read': roster.at[i, 'school'] in csv_schools, 'title': rec.get('title', ''),
                     'has_papers': i in with_papers})
    path = MISSING_HOMEPAGES
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pd.DataFrame(rows, columns=['hein_name', 'school', 'school_csv_read', 'title', 'has_papers']) \
        .sort_values(['school', 'hein_name']).to_csv(path + '.tmp', index=False)
    os.replace(path + '.tmp', path)
    print(f'  homepages: {len(roster) - len(rows)} of {len(roster)} faculty listings have one; the rest are in '
          f'faculty_runs/missing_homepages.csv')


def default_to(data):
    '''(2026-10-26, the audit of why the list differs from U.S. News: "the default end year follows the visitor's clock",
    and one 2027-dated paper would make 2017-2027 the default on New Year's Day) the default window's last year: the
    latest year whose credits in the default journals (one per current-faculty author per paper, short pieces
    included) are at least 75% of their mean over the five years before it (2026 is about 90% today), never later than
    this year'''
    journals = {i for i, j in enumerate(data['journals']) if j[2] and 1 <= j[2] <= DEFAULT_FLAGSHIP_TOP}
    per = defaultdict(int)
    P = data['papers']
    for p in data['credits']['paper']:
        if P['journal'][p] in journals:
            per[int(P['year'][p])] += 1
    for y in range(min(datetime.now().year, max(per or [0])), min(per or [0]), -1):
        prev = [per.get(y - k, 0) for k in range(1, 6)]
        if prev and per.get(y, 0) >= 0.75 * (sum(prev) / len(prev)):
            return y
    return min(datetime.now().year, max(data['papers']['year']))


def default_ranking(data, years=10, top=30):
    '''the site's default view in Python (DEFAULT_VIEW): main law reviews of the US News top 25, the last `years` year
    labels ending at default_to (2026-10-26: ten labels, 2017-2026, where it had been eleven), US law schools'''
    last = default_to(data)                                       # the site's own default window (app.js)
    journals = {i for i, j in enumerate(data['journals']) if j[2] and 1 <= j[2] <= DEFAULT_FLAGSHIP_TOP}
    score, faculty = defaultdict(float), defaultdict(set)
    P = data['papers']
    for p, person in zip(data['credits']['paper'], data['credits']['person']):
        if P['journal'][p] in journals and last - years + 1 <= P['year'][p] <= last:
            for s in data['people'][person][1]:
                if data['schools'][s][1]:
                    score[s] += 1 / P['authors'][p]
                    faculty[s].add(person)
    snap = {s: round(v, 9) for s, v in score.items()}            # same snapping and rounding as app.js (math check)
    order = sorted(snap, key=lambda s: (-snap[s], data['schools'][s][0]))[:top]
    half_up = lambda x: float(Decimal(repr(round(x, 9))).quantize(Decimal('0.1'), ROUND_HALF_UP))
    return [[data['schools'][s][0], half_up(snap[s] + 1), len(faculty[s])] for s in order]


TAXONOMY_RESEARCH = os.path.join(HERE, 'research', 'taxonomy')    # the subject-area research (taxonomy.json, sources.csv)


def subject_tree():
    """docs/data/taxonomy.json for the Subject areas page (the owner, 2026-10-23: "say how we got those buckets. cite
    the sources, and put that on the web too ... drop-down classifications on where each journal fits"; 2026-10-25:
    "at least three levels in the tree"): the research tree (area > field > topic > sub-topic, each node with its
    description, counts and the outside schemes it matches), the approaches, and every source cited. None if the
    research folder is missing."""
    path = os.path.join(TAXONOMY_RESEARCH, 'taxonomy.json')
    if not os.path.exists(path):
        return None
    t = json.load(open(path, encoding='utf-8'))
    clean = lambda x: str(x or '')
    def as_list(v):
        if isinstance(v, str):
            try:
                import ast
                v = ast.literal_eval(v)
            except (ValueError, SyntaxError):
                return []
        return v if isinstance(v, (list, dict)) else []
    def node(n):
        c = as_list(n.get('counts')) or {}
        out = {'n': clean(n.get('name')), 'd': clean(n.get('description')),
               'c': [c.get('faculty_papers'), c.get('faculty_papers_2016_on'), c.get('faculty')],
               's': [[clean(x.get('title')), x.get('url', '')] for x in as_list(n.get('sources')) if isinstance(x, dict)]}
        also = as_list(n.get('also_listed_under'))
        if also:
            out['x'] = [clean(a) for a in also]
        kids = [node(k) for k in n.get('children', [])]
        if kids:
            out['k'] = kids
        return out
    sources = []
    sp = os.path.join(TAXONOMY_RESEARCH, 'sources.csv')
    if os.path.exists(sp):
        for r in pd.read_csv(sp, dtype=str).fillna('').itertuples():
            sources.append([clean(r.title), r.url, clean(r.what_it_supports), r.verified == 'yes'])
    return {'name': clean(t.get('name')), 'description': clean(t.get('description')), 'version': t.get('version'),
            'generated': t.get('generated'), 'counts': t.get('counts'),
            'areas': [node(a) for a in t.get('children', [])], 'approaches': [node(a) for a in t.get('approaches', [])],
            'sources': sources}


def journal_tree(groups, subjects, journals, field_of, paper_journal, paper_year, credit_paper, credit_person, built,
                 people=(), schools=(), host_rank=()):
    """docs/data/taxonomy.json for the Subject areas page (2026-10-25, the owner: "a clear taxonomy presented as a tree
    structure that pulls information from grouped specialty journals. That's it."): area > field > specialty journal,
    as the rankings group them (each journal in one field, each field in one area), with the papers by current faculty
    in those journals, all years and since 2016, and how many current faculty wrote them. Nothing comes from titles.
    Each area and field keeps its description and the outside schemes it matches from the subject-area research
    (research/taxonomy, subject_tree), and the page lists every source.
    Node: {n: name, d: description, s: [[source, url]], c: [papers, papers since 2016, faculty], k: fields (an area) or
    j: [[journal id, papers, since 2016, faculty, counts toward the field (1/0)], ...] (a field)}
    (2026-10-26, the owner: "there needs to be a really clear line between specalty journal and then category. then use
    that category to place authors into buckets ... cite all of the work"): each area (the category) also carries its
    bucket of authors, b: [faculty with an article in its journals, [[person id, articles], ... the 15 with most]], and
    the tree carries each journal's placement with its citation, placed: {journal id: [rule, deciding words, scope
    statement, its URL, where it was quoted from, W&L subjects]}, from TAXONOMY_FILE."""
    research = subject_tree() or {'areas': [], 'approaches': [], 'sources': [], 'name': '', 'description': ''}
    about = {'General & Policy Journals': {'d': 'Journals whose own scope statement covers law, or law and public policy, generally, '
                                                 'with no subject focus. Their papers count in the rankings when this group is chosen; '
                                                 'they give no one an area.'},
             'No subject focus': {'d': 'Placed here because the journal describes its scope as law or policy generally.'}}
    for top in research['areas'] + research['approaches']:
        about.setdefault(top['n'], top)
        for k in top.get('k', []):
            about.setdefault(k['n'], k)
    # the groups' own definitions (and the scope words behind them) win over the older research fields' descriptions
    if os.path.exists(GROUPS_FILE):
        for r in pd.read_csv(GROUPS_FILE, dtype=str).fillna('').itertuples():
            about[r.group] = {'d': r.definition, 'w': r.why, 's': about.get(r.group, {}).get('s', [])}
    papers_in, people_in = defaultdict(set), defaultdict(set)
    bucket = defaultdict(lambda: defaultdict(int))     # area id -> person -> articles in its journals (as people[i][4])
    area_of_journal = {ji: journals[ji][4][0][0] for ji in field_of}
    for pk, person_i in zip(credit_paper, credit_person):
        papers_in[paper_journal[pk]].add(pk)
        people_in[paper_journal[pk]].add(person_i)
        g = area_of_journal.get(paper_journal[pk])
        if g is not None:
            bucket[g][person_i] += 1
    def count(jis):
        ps = set().union(*(papers_in[ji] for ji in jis)) if jis else set()
        fs = set().union(*(people_in[ji] for ji in jis)) if jis else set()
        return [len(ps), sum(1 for pk in ps if paper_year[pk] >= 2016), len(fs)]
    in_field = defaultdict(list)            # field id -> its specialty journals, best W&L score first
    for ji, j in enumerate(journals):
        if j[3]:      # (review) also the two General journals W&L lists under a subject: all 231 in the tree
            in_field[j[3][0][0]].append(ji)
    score = lambda ji: journals[ji][3][0][2] if journals[ji][3][0][2] is not None else -1
    areas, counted = [], []         # counted: every journal in the tree
    for g, area in enumerate(groups):
        fields = []
        for f in sorted((f for f in in_field if journals[in_field[f][0]][4][0][0] == g), key=lambda f: subjects[f]):
            jis = sorted(in_field[f], key=lambda ji: (-score(ji), journals[ji][0]))
            info = about.get(subjects[f], {})
            fields.append({'n': subjects[f], 'd': info.get('d', ''), 'w': info.get('w', ''), 's': info.get('s', []), 'c': count(jis),
                           'j': [[ji] + count([ji]) + [1 if ji in field_of else 0] for ji in jis]})
            counted += jis
        if not fields:
            continue
        info = about.get(area, {})
        top = sorted(bucket[g].items(), key=lambda x: (-x[1], x[0]))[:15]
        # (2026-10-26, the owner: "use lazy loading") the bucket names its people itself, so the page needs no data.json
        areas.append({'n': area, 'd': info.get('d', ''), 's': info.get('s', []),
                      'c': count([ji for fl in fields for ji, *_ in fl['j']]), 'k': fields,
                      'b': [len(bucket[g]), [[people[pi][0], '; '.join(schools[sc][0] for sc in people[pi][1]), people[pi][3] or '', n]
                                             for pi, n in top]]})
    total = count(counted)
    # each journal's placement and what it rests on (journal_taxonomy_scope.csv); a journal W&L ranks after the table was
    # made rests on its W&L subject until it is placed the same way
    placed = {}
    tax = pd.read_csv(TAXONOMY_FILE, dtype=str).fillna('') if os.path.exists(TAXONOMY_FILE) else pd.DataFrame()
    rows = {r['journal']: r for r in tax.to_dict('records')} if len(tax) else {}
    for ji in counted:
        r = rows.get(journals[ji][0])
        if r:
            placed[ji] = [r.get('basis', ''), r.get('deciding_words', ''), r.get('scope_statement', ''), r.get('scope_url', ''),
                          r.get('scope_source', ''), r.get('wl_subjects', '')]
        else:
            placed[ji] = ['by its W&L subject (not yet placed by its scope statement)', '', '', '', '', '']
    # each journal's name, publishing school (and its U.S. News rank) or publisher, and W&L score
    jinfo = {ji: [journals[ji][0], (journals[ji][5] if len(journals[ji]) > 5 else ['', '', '', ''])[0],
                  (journals[ji][5] if len(journals[ji]) > 5 else ['', '', '', ''])[3],
                  host_rank[ji] if ji < len(host_rank) else None, journals[ji][3][0][2] if journals[ji][3] else None] for ji in counted}
    return {'name': 'Subject areas of the specialty journals', 'generated': built,
            'counts': {'faculty_papers': total[0], 'faculty_papers_2016_on': total[1], 'faculty': total[2]},
            'areas': areas, 'placed': placed, 'jinfo': jinfo, 'sources': research['sources']}


def beta_title_areas(paper_keys, credit_paper, credit_person, groups, n_people):
    '''docs/data/beta.json, read only when a visitor turns the beta on: each person's categories as the title model
    (models/title_area.py) would give them, from every credited article's title in any journal (flagship reviews
    included), counting only titles it is at least TITLE_AREA_MIN_P sure of; and the model's cross-validated scores.
    None when the model has not been run.'''
    if not os.path.exists(TITLE_AREA):
        return None
    pred = read_csv_safely(TITLE_AREA, dtype={'title_key': str, 'category': str})
    version = str(pred['version'].iloc[0]) if len(pred) else ''
    report = os.path.join(MODELS_DIR, f'title_area-{version}.json')
    model = json.load(open(report, encoding='utf-8')) if os.path.exists(report) else {}
    gid = {g: i for i, g in enumerate(groups)}
    sure = pred[pred['p'] >= TITLE_AREA_MIN_P]
    area_of = {k: gid[c] for k, c in zip(sure['title_key'], sure['category']) if c in gid}
    tk = [k.rsplit('|', 1)[-1].split('#', 1)[0] for k in paper_keys]
    per = defaultdict(lambda: defaultdict(int))
    for pk, person in zip(credit_paper, credit_person):
        g = area_of.get(tk[pk])
        if g is not None:
            per[person][g] += 1
    people = [[[g, n] for g, n in sorted(per[i].items(), key=lambda x: (-x[1], x[0]))] for i in range(n_people)]
    print(f'  beta (title model {version}): {sum(1 for p in people if p)} people with titled categories; '
          f'{len(area_of)} of {len(pred)} titles at p >= {TITLE_AREA_MIN_P}')
    keep = ('version', 'accuracy', 'top3_accuracy', 'macro_f1', 'baseline_accuracy', 'trained_titles', 'journals', 'cv')
    return {'model': {k: model.get(k) for k in keep}, 'min_p': TITLE_AREA_MIN_P, 'people': people}


def split_for_site(data):
    '''(2026-10-26, the owner: "why does the website take so long to load. use lazy loading so that the main ranking shows
    first") the site's data in two files: data.json, what the ranking needs (each person as [name, schools]; the papers'
    years as counts per year, since papers are numbered in year order; short pieces and co-authored papers as lists of
    their ids), and people.json, what opening a person needs ([homepage, areas, fields, field articles] per person),
    loaded after the ranking is on screen; credits in paper order. masthead.js (LSR.unpack, LSR.people) puts them back together. The papers'
    kinds and lengths stay in the build (meta counts them).'''
    P = data['papers']
    years = [int(y) for y in P['year']]
    papers = {'n': len(years), 'journal': P['journal'],
              'minor_ids': [i for i, m in enumerate(P['minor']) if m],
              'authors_not_1': [[i, int(n)] for i, n in enumerate(P['authors']) if n != 1]}
    if years and all(a <= b for a, b in zip(years, years[1:])):
        papers['years'] = [years[0], [years.count(y) for y in range(years[0], years[-1] + 1)]]
    else:                                   # not in year order (never, since paper ids are sorted by year): as it is
        papers['year'] = years
    # credits in paper order, as each credited person in turn and, for the papers with more than one credited author,
    # how many (gzip shrinks this to half of the plain paper/person pairs)
    pairs = sorted(zip(data['credits']['paper'], data['credits']['person']))
    per = defaultdict(int)
    for pk, _ in pairs:
        per[pk] += 1
    # every paper whose count is not 1 (0 too: a paper whose only credit was taken back, e.g. a student note)
    credits = {'who': [q for _, q in pairs], 'more': [[pk, per.get(pk, 0)] for pk in range(len(years)) if per.get(pk, 0) != 1]}
    core = dict(data, papers=papers, credits=credits, people=[[p[0], p[1]] for p in data['people']])
    details = [[p[3], p[4], p[5], p[6]] for p in data['people']]
    return core, details


PANEL_SINCE = 1980     # insights: "the same journals throughout" = journals with articles in every five years since


def coauthorship(papers, n_authors, is_short, journals):
    '''docs/data/insights.json for the Insights page (2026-10-25, the owner: "co-authorship used to happen less and
    today it is happening more"): per year and kind of journal, how many pieces had 1, 2, 3, 4+ authors. Every piece in
    every collected journal counts, whoever wrote it (not only current faculty, so the trend is not about who is on
    a faculty today). Kinds: flagship law reviews, online editions and other general journals, specialty journals.
    Each count also for research articles only (short pieces left out, as on the rankings page) and for the "panel":
    journals with articles in every five years since PANEL_SINCE, so a trend is not just new journals coming in.'''
    # (review) the same rule as the Insights page's question 1: a journal with a W&L subject is a specialty journal,
    # including the two General journals W&L also lists under one
    kind_of = {j[0]: ('specialty' if j[2] is None or j[3] else 'online' if j[2] < 0 else 'flagship') for j in journals}
    per = papers.groupby('paper_key', sort=False).agg(journal=('journal', 'first'), year=('year', 'first'))
    per['n'] = n_authors.reindex(per.index).fillna(1).astype(int).clip(lower=1)
    per['short'] = [is_short(k) for k in per.index]
    per['kind'] = per['journal'].map(kind_of)
    per = per[per['kind'].notna()]
    last_bin = (datetime.now().year - 5) // 5 * 5
    bins = per.assign(b=per['year'] // 5 * 5).groupby('journal')['b'].agg(set)
    panel = {j for j, b in bins.items() if set(range(PANEL_SINCE, last_bin + 1, 5)) <= b}
    years = list(range(int(per['year'].min()), int(per['year'].max()) + 1))
    kinds = ['flagship', 'online', 'specialty']
    out = {'kinds': kinds, 'years': years, 'pieces': int(len(per)),
           'panel': {'since': PANEL_SINCE, 'journals': len(panel), 'names': sorted(panel)},
           'columns': ['pieces', 'one author', 'two', 'three', 'four or more', 'authors in all']}
    for name, rows in (('all', per), ('articles', per[~per['short']]),
                       ('panel_all', per[per['journal'].isin(panel)]),
                       ('panel_articles', per[per['journal'].isin(panel) & ~per['short']])):
        b = rows['n'].clip(upper=4)
        t = pd.DataFrame({'kind': rows['kind'], 'year': rows['year'], 'b': b, 'n': rows['n']})
        counts = t.groupby(['kind', 'year', 'b']).size().unstack('b', fill_value=0).reindex(columns=[1, 2, 3, 4], fill_value=0)
        total = t.groupby(['kind', 'year'])['n'].sum()
        out[name] = {}
        for k in kinds:
            series = []
            for y in years:
                c = counts.loc[(k, y)].tolist() if (k, y) in counts.index else [0, 0, 0, 0]
                series.append([int(sum(c))] + [int(x) for x in c] + [int(total.get((k, y), 0))])
            out[name][k] = series
    return out


TITLE_SINCE = 1980     # insights: title length per year from here (fewer collected volumes before)
TITLE_MIN_N = 30       # a year's point is shown from this many titles in its band
TITLE_BANDS = [('Top 14', 1, 14), ('15–25', 15, 25), ('26–50', 26, 50), ('51–100', 51, 100), ('101 & below, unranked', 101, 10 ** 6)]   # the Insights page's groups
# the section labels HeinOnline appends to a title ("... Note", "... Book Review", "... Recent Developments 2016-2017");
# only labels that never end a real title, so a title like "Judicial Review" or "A Reply" keeps its last word
TITLE_LABEL = re.compile(
    r'(?:\s+(?:Student\s+)?(?:Notes?|Comments?|Casenotes?|Case\s+(?:Notes?|Comments?)|Recent\s+(?:Cases?|Developments?|Decisions?)|'
    r'Essays?|Articles?|Book\s+(?:Reviews?|Notes?)|Symposium|Foreword|Commentary|Commentaries|Lectures?|Tribute|'
    r'Notes\s+(?:and|&)\s+Comments|Articles\s+(?:and|&)\s+Essays|Annual\s+Survey|Current\s+Developments?(?:\s+\d{4}(?:-\d{2,4})?)?))+\s*$')
STUDENT_LABEL = re.compile(r'\b(?:Notes?|Comments?|Casenotes?|Case\s+(?:Notes?|Comments?)|Recent\s+(?:Cases?|Decisions?)|Student\s+\w+)\b')
BOOK_LABEL = re.compile(r'\bBook\s+(?:Reviews?|Notes?)\s*$')
BOOK_SURVEY = re.compile(r'\bSurvey of Books Relat(?:ing|ed) to the Law\b')


def title_lengths(papers, is_short, journals, paper_keys, credit_paper, credit_person, people, schools):
    '''insights.json['titles'] (2026-10-26, the owner: "add analysis on title character length over time. break it out
    per law review rank and school rank"): the median length in characters of research-article titles per year,
    (1) by the U.S. News rank of the school whose main law review published it (every article in those reviews,
    whoever wrote it) and (2) by the U.S. News rank of the school of the current faculty member credited with it (any
    journal; a piece by authors at schools in two bands counts once in each). Bands as elsewhere on the Insights page.

    HeinOnline glues section headings onto titles with no separator ("... Note", "... Symposium: Law and the
    Internet"), so a title is measured only when its heading can be taken off for certain: the labels in TITLE_LABEL
    are removed, and a title is left out rather than cut at a guess when its last 2-8 words end two or more other
    titles of the same volume, or any five words in a row of it appear in two or more other titles of the volume (a
    symposium's, a survey's or a panel's heading, wherever it sits). Also left out: short pieces (as on the rankings
    page), book reviews (the book's title; also the Michigan Law Review's "Survey of Books Relating to the Law"), and
    in (1) the pieces labelled as student work (Note, Comment, Casenote, Recent Case, Student ...). Each point:
    [median characters, mean, titles, share with a subtitle (a colon)], or None under TITLE_MIN_N titles; per band
    'y' (each year, the table) and 'p' (the year and the years either side pooled, the chart's line); *_summary:
    2000-2004 and the last five full years, per band and for all bands together. (review, 2026-10-27) Because the
    left-out pieces are many and differ by band and era, the output also says how many the heading rule left out
    (*_left_out) and what the summaries would be with each glued heading cut off at the longest ending it shares
    instead (*_summary_cut, a check only: the cut is a guess that is right about five times in six).'''
    t = papers.drop_duplicates('paper_key').set_index('paper_key')[['journal', 'volume_key', 'title', 'year']]
    t['title'] = t['title'].astype(str).str.strip()
    t['clean'] = t['title'].map(lambda s: TITLE_LABEL.sub('', s).rstrip(' -:;,'))
    glued, cut = set(), {}
    for _, g in t.groupby(['journal', 'volume_key'], sort=False):
        ends, runs = Counter(), Counter()
        for s in set(g['clean']):
            w = s.split()
            ends.update({' '.join(w[-n:]) for n in range(2, min(8, len(w) - 2) + 1)})
            runs.update({' '.join(w[i:i + 5]) for i in range(len(w) - 4)})
        for k, s in zip(g.index, g['clean']):
            w = s.split()
            end = next((n for n in range(min(8, len(w) - 2), 1, -1) if ends[' '.join(w[-n:])] >= 3), 0)
            if end or any(runs[' '.join(w[i:i + 5])] >= 3 for i in range(len(w) - 4)):
                glued.add(k)
                if end:
                    cut[k] = ' '.join(w[:-end]).rstrip(' -:;,')
    t['eligible'] = [not BOOK_LABEL.search(raw) and not BOOK_SURVEY.search(raw) and not is_short(k) and len(s) > 0
                     for k, s, raw in zip(t.index, t['clean'], t['title'])]
    t['glued'] = t.index.isin(glued)
    t['ok'] = t['eligible'] & ~t['glued']
    t['student'] = [bool(m and STUDENT_LABEL.search(m.group(0))) for m in map(TITLE_LABEL.search, t['title'])]
    t['chars'] = t['clean'].str.len()
    t['colon'] = t['clean'].str.contains(':', regex=False)
    last = min(int(t['year'].max()), datetime.now().year)     # (a few volumes are labelled with next year)
    t = t[(t['year'] >= TITLE_SINCE) & (t['year'] <= last)]
    years = list(range(TITLE_SINCE, last + 1))

    def band(rank):
        rank = rank or 10 ** 6 - 1          # unranked: with 101 and below, as elsewhere on the Insights page
        return next(b for b, lo, hi in TITLE_BANDS if lo <= rank <= hi)

    def stat(rows):
        n = len(rows)
        return ([float(rows['chars'].median()), round(float(rows['chars'].mean()), 1), n, round(float(rows['colon'].mean()), 3)]
                if n >= TITLE_MIN_N else None)

    def series(rows):
        # per year: that year's titles ('y', the table) and the three years around it pooled ('p', the chart's line)
        by = dict(tuple(rows.groupby('year')))
        none = rows.iloc[:0]
        return {'y': [stat(by.get(y, none)) for y in years],
                'p': [stat(pd.concat([by.get(x, none) for x in (y - 1, y, y + 1) if TITLE_SINCE <= x <= last])) for y in years]}

    full = min(last, datetime.now().year - 1)            # the summary's last five years: full years only
    windows = [[2000, 2004], [full - 4, full]]
    within = lambda rows, w: rows[(rows['year'] >= w[0]) & (rows['year'] <= w[1])]
    def summary(rows):
        return [stat(within(rows, w)) for w in windows]
    def left_out(rows):                                  # of the eligible pieces, the share the heading rule left out
        return [round(float(within(rows, w)['glued'].mean()), 3) if len(within(rows, w)) else None for w in windows]
    def summary_cut(rows):                               # the check: glued headings cut off instead of left out
        r = rows[~rows['glued'] | rows.index.isin(cut)].copy()
        r['chars'] = [len(cut[k]) if k in cut else c for k, c in zip(r.index, r['chars'])]
        r['colon'] = [(':' in cut[k]) if k in cut else c for k, c in zip(r.index, r['colon'])]
        return summary(r)

    flagship = {j[0]: band(j[2]) for j in journals if j[2] is not None and j[2] >= 0}
    rev_all = t[t['eligible'] & ~t['student'] & t['journal'].isin(flagship)].copy()
    rev_all['band'] = rev_all['journal'].map(flagship)

    school_band = [band(rank_number(s[2])) if s[1] else None for s in schools]      # US law schools only
    pairs = set()
    for pk, person in zip(credit_paper, credit_person):
        for s in people[person][1]:
            if school_band[s] is not None:
                pairs.add((paper_keys[pk], school_band[s]))
    fac_all = pd.DataFrame(sorted(pairs), columns=['paper_key', 'band'])
    fac_all = fac_all.join(t[t['eligible']], on='paper_key', how='inner').set_index('paper_key', drop=False)
    rev, fac = rev_all[~rev_all['glued']], fac_all[~fac_all['glued']]
    out = {'years': years, 'bands': [b for b, _, _ in TITLE_BANDS], 'min_n': TITLE_MIN_N, 'windows': windows,
           'columns': ['median characters', 'mean', 'titles', 'share with a subtitle'],
           'counts': {'review_titles': int(len(rev)), 'school_titles': int(fac['paper_key'].nunique()),
                      'measured': int(t['ok'].sum()), 'all': int(len(t)), 'left_out': int((~t['ok']).sum()),
                      'glued': int(t['glued'].sum())}}
    for name, rows, every in (('review', rev, rev_all), ('school', fac, fac_all)):
        once = (lambda r: r.drop_duplicates('paper_key')) if name == 'school' else (lambda r: r)
        out[name] = {b: series(rows[rows['band'] == b]) for b, _, _ in TITLE_BANDS}
        for suffix, f, src in (('_summary', summary, rows), ('_left_out', left_out, every), ('_summary_cut', summary_cut, every)):
            out[name + suffix] = {b: f(src[src['band'] == b]) for b, _, _ in TITLE_BANDS}
            out[name + suffix]['all'] = f(once(src))
    return out


def git_json(path):
    '''the last committed copy of a JSON file in this repo, or {} if there is none'''
    r = subprocess.run(['git', 'show', 'HEAD:' + path], cwd=HERE, capture_output=True, text=True)
    try:
        return json.loads(r.stdout) if r.returncode == 0 else {}
    except ValueError:
        return {}


def update_history(meta, data, prev):
    '''docs/data/history.json: one entry per build, so changes between builds can be seen on the site'''
    path = os.path.join(OUT_DIR, 'history.json')
    history = []
    if os.path.exists(path):
        try:
            with open(path, encoding='utf-8') as f:
                history = json.load(f)
        except ValueError:     # killed mid-write (review): fall back to the committed copy
            history = git_json('docs/data/history.json') or []
    entry = {
        'version': meta['version'], 'kind': meta['kind'], 'date': meta['built'], 'data_updated': meta['data_updated'],
        'hash': meta.get('build_hash'), 'papers_collected': meta['papers_collected'], 'faculty_collected': meta['faculty_collected'],
        'rankings_edition': meta['rankings']['edition'], 'us_schools': meta.get('us_schools'),
        'flagship_ranks': meta['flagship_ranks'], 'default_view': meta['default_view'],
        'counts': meta['counts'], 'top': default_ranking(data),
    }
    if history and history[-1].get('version') == meta['version']:
        # nothing changed since the last build: refresh its entry, keep the number and what changed in it
        if 'changes' in history[-1]:
            entry['changes'] = history[-1]['changes']
        history[-1] = entry
    else:
        if history:
            before = history[-1]
            old_rank = {s: i for i, (s, _, _) in enumerate(before['top'], start=1)}
            entry['changes'] = {
                'papers': meta['counts']['papers'] - before['counts']['papers'],
                'faculty_with_papers': meta['counts']['faculty_with_papers'] - before['counts']['faculty_with_papers'],
                'moved': [[s, old_rank.get(s), i] for i, (s, _, _) in enumerate(entry['top'], start=1) if old_rank.get(s) != i],
            }
            if before.get('default_view') != entry['default_view']:
                # a different default view: its top 30 isn't comparable with the previous build's
                entry['changes']['moved'] = []
                entry['changes']['view_changed'] = entry['default_view']
        history.append(entry)
    meta['history_entry'] = entry
    return history


def build():
    print('reading the collected metadata in', SOURCE_DIR)
    papers, coverage = load_papers()
    roster = load_roster()
    wl_year, rankings, rankings_fetched = load_rankings()
    us, us_meta, usnews_table, peer_table = load_us_schools(roster['school'].unique())
    aba, aba_check = load_aba(roster['school'].unique())
    extra = sorted(set(aba) - set(us))
    if extra:
        print(f'  {len(extra)} ABA-approved schools not matched to US News, counted as US law schools too:', extra)
    print(f"  US law schools: {len(set(us) | set(aba))} ({us_meta['schools']} from {us_meta['source']}, "
          f"{len(aba)} from the ABA list)")

    ##### journals and their categories
    # 2026-10-25 (the owner: "Use a drop down taxonomy for the specialty journals. So you click on a topic to see which
    # journals fit that category"): specialty journals are grouped by the taxonomy (journal_taxonomy_scope.csv: each
    # journal's area > field, placed by its own scope statement and W&L subject; see TAXONOMY_FILE): areas are the groups,
    # fields the sub-items; a W&L specialty journal not mapped yet goes to "Other specialty journals" under its W&L
    # subject (and is printed)
    ranked = rankings[rankings['journal'].isin(papers['journal'].unique())]
    tax = pd.read_csv(TAXONOMY_FILE, dtype=str).fillna('') if os.path.exists(TAXONOMY_FILE) else pd.DataFrame(columns=['journal', 'primary_path'])
    area_field = {}
    for r in tax.itertuples():
        parts = [p.strip() for p in r.primary_path.split('>')]
        if len(parts) >= 2:
            area = 'Interdisciplinary Methods' if parts[0] == 'Approaches' else parts[0]
            area_field[r.journal] = (area, parts[1])
    spec = ranked[ranked['journal_type'] != 'General'].copy()
    # a journal not mapped by name takes the group of its best W&L subject (wl_subject_taxonomy.csv); a W&L subject
    # not in that crosswalk either: "Other specialty journals" (printed)
    cross = {}
    if os.path.exists(WL_CROSSWALK):
        for r in pd.read_csv(WL_CROSSWALK, dtype=str).fillna('').itertuples():
            parts = [p.strip() for p in r.area_field.split('>')]
            if len(parts) >= 2:
                cross[r.wl_subject] = ('Interdisciplinary Methods' if parts[0] == 'Approaches' else parts[0], parts[1])
    by_subject, other = 0, []
    for j in sorted(set(spec['journal']) - set(area_field)):
        rows = spec[spec['journal'] == j].sort_values('WandL_rank')
        hit = next((cross[t] for t in rows['journal_type'] if t in cross), None)
        if hit:
            area_field[j] = hit
            by_subject += 1
        else:
            area_field[j] = ('Other specialty journals', rows['journal_type'].iloc[0])
            other.append(j)
    if by_subject:
        print(f'  {by_subject} specialty journals placed by their W&L subject (not in journal_taxonomy_scope.csv yet)')
    if other:
        print(f'  !! {len(other)} specialty journals with a W&L subject the crosswalk lacks, under "Other specialty journals":', other[:10])
    used = {area_field[j] for j in set(spec['journal'])}
    groups = [g for g in AREA_ORDER + ['Other specialty journals'] if any(a == g for a, _ in used)]
    groups += sorted({a for a, _ in used} - set(groups))
    subjects = sorted({f for _, f in used})
    subject_to_group = {f: a for a, f in used}
    best = spec.groupby('journal').agg(rank=('WandL_rank', 'min'), score=('score', 'max'))
    group_rank = {}
    for g in groups:
        members = [j for j in best.index if area_field[j][0] == g]
        order = best.loc[members].sort_values('score', ascending=False)
        for pos, (j, sc) in enumerate(order['score'].items(), start=1):
            group_rank[(j, g)] = pos if pd.notna(sc) else None

    # the school that publishes each specialty journal (specialty_hosts.csv), and its ranks
    hosts = {}
    if os.path.exists(SPECIALTY_HOSTS):
        for r in pd.read_csv(SPECIALTY_HOSTS, dtype=str).fillna('').itertuples():
            hosts[r.journal] = (r.host, r.publisher)

    journal_names = sorted(ranked['journal'].unique())
    journal_id = {j: i for i, j in enumerate(journal_names)}
    collected_on = dict(zip(coverage['journal'], coverage['collected']))
    journals = []
    flagship = load_flagship(sorted(ranked.loc[ranked['journal_type'] == 'General', 'journal'].unique()), usnews_table, peer_table)
    # per journal and source: the rank the flagship tiers use (rank_by: general journals only, None for the rest) and
    # the host school's rank the specialty filter uses (host_by: specialty journals only). (audit, 2026-10-25) one
    # list for both put specialty journals into the flagship tiers, and two General journals that W&L also lists
    # under a subject (Journal of Legal Analysis, University of Chicago Legal Forum) into tier 1-25
    rank_by = {'usnews': [], 'peer': []}
    host_by = {'usnews': [], 'peer': []}
    for j in journal_names:
        # flagship: the school's US News rank (0 = unranked school, -1 = online edition or other general
        # journal, None = not a General journal); the W&L General rank is not used
        general_rank, host, peer_rank = flagship.get(j, [None, None, None])
        rank_by['usnews'].append(general_rank)
        rank_by['peer'].append(peer_rank)
        host_by['usnews'].append(None)
        host_by['peer'].append(None)
        subs, grps = [], []
        if j in best.index:
            area, field = area_field[j]
            sc = best.at[j, 'score']
            # [field id, W&L rank (0 = NR), W&L score] - the site re-ranks groups from the scores
            subs = [[subjects.index(field), int(best.at[j, 'rank']) if pd.notna(sc) else 0, float(sc) if pd.notna(sc) else None]]
            grps = [[groups.index(area), group_rank.get((j, area)) or 0]]
            school, publisher = hosts.get(j, ('', ''))
            if school or publisher:
                lab = usnews_table.get(school) if school else ''
                # (review) a General journal W&L also lists under a subject (Journal of Legal Analysis, University of
                # Chicago Legal Forum) keeps its kind from flagship_schools.csv for the "other general journals" tier
                host = [school, (lab or 'Unranked') if school else '', host[2] if host else 'specialty', publisher]
            host_by['usnews'][-1] = rank_number(usnews_table.get(school)) if school else -1
            host_by['peer'][-1] = rank_number(peer_table.get(school)) if school else -1
        journals.append([j, collected_on[j], general_rank, subs, grps] + ([host] if host else []))

    not_ranked = sorted(set(papers['journal']) - set(journal_names))
    if not_ranked:
        print(f'  {len(not_ranked)} collected journals are not on W&L {wl_year} (renamed or dropped), skipping:', not_ranked)
    papers = papers[papers['journal'].isin(journal_id)]

    ##### authorship credit
    # (review, 2026-10-23) Hein can list several separate pieces under one title in a volume (a "Chairman's Page" in each
    # issue, several tributes); each piece starts with a "first" author, so pieces are numbered, not merged into one
    # co-authored paper (which split each author's credit)
    # (pairing audit, 2026-10-26) Hein lists some articles with their responses as one entry ("Kyoto at the Local Level
    # ... (with Responses by Bill Becker & Amy Royden-Bloom and Roger R. Martella & James W. Coleman)"): the
    # respondents are not the article's authors. An author whose surname is named after "with Response(s) / Reply /
    # Comment(s) by" in the title is left out (unless that would leave no author).
    tail = papers['title'].str.extract(r'(?i)\bwith\s+(?:a\s+)?(?:responses?|repl(?:y|ies)|comments?|commentar(?:y|ies))\s+by\b(.*)$')[0]
    has_tail = tail.notna()
    if has_tail.any():
        fold_words = lambda t: ' ' + ' '.join(re.sub(r'[^a-z ]', ' ', unicodedata.normalize('NFKD', t.lower())).split()) + ' '
        named = pd.Series([raw_last(a) and (' ' + raw_last(a) + ' ') in fold_words(t) if h else False
                           for a, t, h in zip(papers['author'], tail.fillna(''), has_tail)], index=papers.index)
        keep_all = named.groupby([papers['journal'], papers['volume_key'], papers['title_key']]).transform('all')
        drop = named & ~keep_all
        if drop.any():
            print(f'  {int(drop.sum())} respondents left out of {papers[drop].groupby(["journal", "volume_key", "title_key"]).ngroups} '
                  f'articles listed "with responses by"')
            papers = papers[~drop]
    starts = papers['authorship_position'].astype(str).str.startswith('first')
    piece = starts.groupby([papers['journal'], papers['volume_key'], papers['title_key']], sort=False).cumsum().clip(lower=1)
    papers['paper_key'] = papers['journal'] + '|' + papers['volume_key'] + '|' + papers['title_key'] + '#' + piece.astype(str)
    # PATCH 17: measured in load_papers over every entry of the volume (journal_store.entry_lengths: Hein's page
    # sequence, unsigned entries included)
    length_of = papers.groupby('paper_key', sort=False)['length'].first().to_dict()
    # authors compared by parsed name, not Hein's raw spelling ("James A.R." / "James A. R.") (math check)
    name_of = {u: '/'.join(parse_hein_name(u)) for u in papers['author'].unique()}
    papers['name_key'] = papers['author'].map(name_of)
    info = papers.groupby('paper_key').agg(journal=('journal', 'first'), volume_key=('volume_key', 'first'),
                                           title_key=('title_key', 'first'), year=('year', 'first'))
    info['authors'] = papers.groupby('paper_key')['name_key'].agg(lambda a: '|'.join(sorted(set(a))))
    # the piece's first page, where it was collected ("... | Page 125"): a recurring piece by the same author in
    # each issue (a "Chairman's Page") starts on a different page, a piece listed twice starts on the same one
    # (stress test, 2026-10-24) any page token ("[xv]", "iii", "125"), not only digits: two pieces both on an unnumbered
    # page were taken for the same piece
    # (pairing audit, 2026-10-26) the page from the record's LAST segment: a title with "Page" in it ("The Editors' Page |
    # ... | Page v") gave "|" or "Comments" as the page and merged 262 distinct pieces; and issues that restart their
    # page numbers put different pieces on one printed page, so collected pieces (Hein's page id in article_link) are
    # the same piece only with the same id. A piece with no page (collected before raw records were kept) is never
    # merged on a blank page.
    info['page'] = papers.groupby('paper_key')['raw'].first().fillna('').str.extract(r'(?:^|\| )Page (\S+)\s*$')[0].fillna('')
    info['hein_id'] = papers.groupby('paper_key')['article_link'].first().fillna('').str.extract(r'[?&]id=(\d+)')[0].fillna('')
    info['sig'] = list(zip(info['journal'], info['year'], info['title_key'], info['authors']))
    # the same piece twice: within a volume (listed twice) always one paper; across two volume numbers of the same year
    # (Urban Lawyer 42 and 43, "Volume 58 (Supplement)" inside vol 58) only when the two volumes duplicate each other
    # wholesale (3+ shared papers or half the smaller one), so a recurring "Foreword" by the same editor in two volumes
    # of one year stays two papers (review)
    size = info.groupby(['journal', 'volume_key']).size()
    dup_groups = [sorted(g.index) for _, g in info.groupby('sig') if len(g) > 1]
    shared = defaultdict(int)
    for keys in dup_groups:
        vols = sorted({info.at[k, 'volume_key'] for k in keys})
        for a in range(len(vols)):
            for b in range(a + 1, len(vols)):
                shared[(info.at[keys[0], 'journal'], vols[a], vols[b])] += 1
    # (stress test, 2026-10-24) half the smaller volume, at least 2: "3 or more" alone merged 4 shared pieces of two
    # 90-piece volumes that are not duplicates
    wholesale = {k for k, n in shared.items() if n >= 2 and n >= 0.5 * min(size[(k[0], k[1])], size[(k[0], k[2])])}
    same, within, across = {}, 0, 0
    for keys in dup_groups:
        first = keys[0]
        v1 = info.at[first, 'volume_key']
        for k in keys[1:]:
            v2 = info.at[k, 'volume_key']
            if v2 == v1:
                i1, i2 = info.at[first, 'hein_id'], info.at[k, 'hein_id']
                p1, p2 = info.at[first, 'page'], info.at[k, 'page']
                if (i1 == i2) if (i1 and i2) else (p1 != '' and p1 == p2):     # the same piece: listed twice
                    same[k], within = first, within + 1
            elif (info.at[first, 'journal'], *sorted([v1, v2])) in wholesale:
                same[k], across = first, across + 1
    # (pairing audit, 2026-10-26) an article Hein lists in two entries of one volume, the second marked "(cont.)",
    # "(continued)" or "(concluded)", by the same authors: one paper
    cont = 0
    by_entry = {(r.journal, r.volume_key, r.authors, r.title_key): k for k, r in info.iterrows()}
    for k, r in info.iterrows():
        m = re.match(r'^(.+?)(?:cont|continued|concluded|conclusion)$', r.title_key)
        if m and k not in same:
            base = by_entry.get((r.journal, r.volume_key, r.authors, m.group(1)))
            if base and base != k:
                same[k], cont = same.get(base, base), cont + 1
    if same:
        print(f'  {across} papers listed twice by Hein in the same year (two volume numbers), {within} listed twice '
              f'in one volume and {cont} continued in a second entry; counted once')
        papers['paper_key'] = papers['paper_key'].map(lambda k: same.get(k, k))
    # co-authors counted as people: two spellings of one name in a paper ("McClurg, Andrew J." and "McClurg, Andrew
    # Jay") are one author (math check)
    def count_people(keys):
        by = defaultdict(set)
        for k in set(keys):
            last, first, middle = k.split('/', 2)
            by[(last, first)].add(middle[:1])
        return sum(max(1, len(m - {''})) for m in by.values())
    n_authors = papers.groupby('paper_key')['name_key'].agg(count_people)
    write_faculty_list(roster)
    # (audit, 2026-10-25) the journals that are not a school's (flagship_schools.csv kind "non_school"): see match_by_name
    non_school = frozenset(j for j, v in flagship.items() if v[1][2] == 'non_school')
    # (naming audit, 2026-10-26) the faculty-list schools that publish each journal (flagship_schools.csv,
    # specialty_hosts.csv): a paper in the person's own school's journal is evidence for match_by_name's second pass
    lists_of_usnews = defaultdict(set)
    for s, v in us.items():
        lists_of_usnews[v[0]].add(s)
    journal_schools = defaultdict(set)
    for j, v in flagship.items():
        if v[1] and v[1][0]:
            journal_schools[j] |= lists_of_usnews.get(v[1][0], set())
    for j, (school, _) in hosts.items():
        if school:
            journal_schools[j] |= lists_of_usnews.get(school, set())
    matched, stats, match_info = match_authors(papers, roster, non_school, journal_schools)
    print('  author matching:', stats)
    write_profile_wants(papers, roster, set(us) | set(aba), match_info)

    credited = papers[papers['author'].isin(matched)].copy()
    held = credited['author'].isin(match_info['held_in_non_school']) & credited['journal'].isin(non_school)
    if held.any():
        print(f'  (audit) {int(held.sum())} paper rows in non-school journals ({", ".join(sorted(credited.loc[held, "journal"].unique()))}) '
              f'not credited: author with no middle initial, faculty member listed with one '
              f'({credited.loc[held, "author"].nunique()} spellings still credited in school journals)')
        credited = credited[~held]
    first_rows = credited.drop_duplicates('paper_key').set_index('paper_key')
    # sorted by year so the titles can be split into per-decade files the site loads on demand
    paper_keys = sorted(first_rows.index, key=lambda k: (first_rows.at[k, 'year'], k))
    paper_id = {k: i for i, k in enumerate(paper_keys)}

    schools = sorted(roster['school'].unique())
    school_id = {s: i for i, s in enumerate(schools)}
    person_rows = sorted({i for idx in matched.values() for i in idx})
    # one person per Hein profile link (search_name; 2026-10-24, the owner: "one author should have one URL
    # reference"), credited at every school that lists them
    person_key = lambda i: match_info['pk'][i]
    people_keys = sorted({person_key(i) for i in person_rows})
    person_id = {k: n for n, k in enumerate(people_keys)}
    # [display name, school ids, Hein search_name, homepage ('' if none)]; the homepage comes from faculty/edits.csv
    # (pull requests win), else from Hein's per-school CSV (2026-10-24, the owner: "i do need a way to link to each person")
    edits = load_faculty_edits()
    homepage = {parse_hein_name(hein_profile_link(r.hein_name)): r.homepage.strip()
                for r in edits[edits['action'] == 'homepage'].itertuples() if r.homepage.strip().startswith('http')}
    school_csv, csv_schools = load_school_csvs()
    # 2026-10-25: then the homepages faculty_links.py (data folder) found on the schools' own websites, by the school's
    # URL naming convention or its faculty directory, for the people the school's list has no homepage for
    inferred = {}
    if os.path.exists(INFERRED_HOMEPAGES):
        try:
            for r in read_csv_safely(INFERRED_HOMEPAGES, dtype=str).fillna('').itertuples():
                if r.homepage.startswith('http'):
                    inferred[(r.school, r.hein_name)] = r.homepage
        except Exception as e:
            print(f'  !! {INFERRED_HOMEPAGES} could not be read ({e!r}); skipped')
    # the homepage from the CSV of the school that lists them (a stale CSV of a school they left never counts)
    home_of = lambda i: (homepage.get((roster.at[i, 'last'], roster.at[i, 'first'], roster.at[i, 'middle']))
                         or school_csv.get((roster.at[i, 'school'], match_info['pk'][i]), {}).get('website', '')
                         or inferred.get((roster.at[i, 'school'], roster.at[i, 'hein_name']), ''))
    people = [[None, [], None, ''] for k in people_keys]
    for i in person_rows:
        p = people[person_id[person_key(i)]]
        p[0] = display_name(roster.at[i, 'author'])
        p[2] = roster.at[i, 'hein_name']
        p[3] = p[3] or home_of(i)
        sid = school_id[roster.at[i, 'school']]
        if sid not in p[1]:
            p[1].append(sid)
    write_missing_homepages(roster, match_info, home_of, school_csv, csv_schools, set(person_rows))

    listed = roster.assign(_pk=match_info['pk']).groupby('school')['_pk'].nunique()   # people on each school's list
    credit_paper, credit_person = [], []
    seen = set()
    for r in credited[['paper_key', 'author']].itertuples(index=False):
        pid = paper_id[r.paper_key]
        for i in matched[r.author]:
            key = (pid, person_id[person_key(i)])
            if key not in seen:
                seen.add(key)
                credit_paper.append(key[0])
                credit_person.append(key[1])
    # (2026-10-26, the audit of why the list differs from U.S. News) a student Note (HeinOnline ends its title with
    # "Note" or "Notes") is not credited to a faculty member whose other credited work began 5 or more years before it:
    # a namesake student wrote it (NYU's Liam B. Murphy was credited with a 2022 Vanderbilt Law Review note). "Comment"
    # is left alone: some reviews' Comments are faculty pieces. (review) Nor are an editor's, editorial, research or
    # historical note: the faculty member's own piece (Family Court Review's "Editorial Notes", Law & Society Review's
    # "Research Note"); Harvard's "Book Notes" stay, a student section.
    faculty_note = re.compile(r"(?i)\b(?:Editor'?s'?|Editors'?|Co-Editors'?|Editorial|Research|Historical)\s+Notes?(?:\s+Notes?)?\s*$")
    note = [bool(re.search(r'\bNotes?\s*$', t)) and not faculty_note.search(t) for t in (str(first_rows.at[k, 'title']) for k in paper_keys)]
    year_of = [int(first_rows.at[k, 'year']) for k in paper_keys]
    first_year = {}
    for pk, person in zip(credit_paper, credit_person):
        if not note[pk]:
            first_year[person] = min(first_year.get(person, 9999), year_of[pk])
    keep = [not (note[pk] and first_year.get(person, 9999) <= year_of[pk] - 5) for pk, person in zip(credit_paper, credit_person)]
    # (review) HeinOnline sometimes labels a volume's faculty articles "Note" (Vanderbilt L. Rev. 55 and 57, the 2017
    # Boston College L. Rev. symposium) or ends a section heading with it (AJIL "Book Reviews and Notes"): a student
    # Note is written alone, and a volume has at most one by a namesake
    out = [pk for pk, k in zip(credit_paper, keep) if not k]
    per_paper, per_vol = Counter(out), defaultdict(set)
    for pk in out:
        per_vol[paper_keys[pk].rsplit('|', 1)[0]].add(pk)
    keep = [k or per_paper[pk] >= 2 or len(per_vol[paper_keys[pk].rsplit('|', 1)[0]]) >= 2 for k, pk in zip(keep, credit_paper)]
    if not all(keep):
        print(f'  {keep.count(False)} student notes not credited to faculty whose credited work began 5+ years earlier')
        credit_paper = [x for x, k in zip(credit_paper, keep) if k]
        credit_person = [x for x, k in zip(credit_person, keep) if k]


    p = first_rows.loc[paper_keys]
    classes = load_classes()
    model_flags, model_info = load_short_model()
    def is_short(k):
        length = length_of.get(k)
        kind, pages, llm_short = classes.get(k, (None, None, False))
        # (review, 2026-10-25) a piece the journal itself heads "In Memoriam" or "In Tribute" (the Harvard Law Review's
        # tributes to retiring and late Justices, signed by six colleagues each) is a memorial, whatever the classifier
        # said: a section heading, not a guess from the title's words
        # (audit, 2026-10-25) HeinOnline usually puts the heading after the title ("Jack In Memoriam", "William H.
        # Rehnquist In Memoriam: ..."), so "inmemoriam" anywhere in the title key counts; "tribute" only at the start
        # ("Family Law Issue: A Tribute to ..." holds full articles). The 20-page rule below still counts long ones.
        tk = k.rsplit('|', 1)[-1].split('#', 1)[0]
        if kind is None and (tk.startswith(('inmemoriam', 'memoriam', 'intribute')) or 'inmemoriam' in tk):
            kind = 'memorial or tribute'
        # (pairing audit, 2026-10-26) a tribute, dedication, remembrance or transcript signed by more than ten people
        # (a symposium's roundtable, a panel) is not a co-authored article: a short piece, like a memorial
        if kind is None and n_authors.get(k, 1) > 10 and any(w in tk for w in MANY_SIGNER_WORDS):
            kind = 'memorial or tribute'
        if kind == 'memorial or tribute' and not (length is not None and length == length and length >= 20):
            return True
        if length is not None and length == length and length >= 1:
            return length < SHORT_PAGES or (kind == 'memorial or tribute' and length < 20)
        if k in model_flags:
            return bool(model_flags[k])    # the trained model's call where the length is not measured
        return bool(llm_short)             # an older classifier's call; neither: it counts
    short_flags = [1 if is_short(k) else 0 for k in paper_keys]

    # What each person works on (2026-10-25, the owner: "I want zero inferences drawn. I want a clear taxonomy presented
    # as a tree structure that pulls information from grouped specialty journals. That's it. If an author only published
    # flagship, then no inference is made. If they have multiple specialty then it might be multi tag. It should be low
    # level specialty grouped into 10 or so higher level areas. Do that instead of guessing area."): the fields and
    # areas of the specialty journals a person published in, and nothing else. Each specialty journal sits in one field
    # (journal_taxonomy_scope.csv), each field in one area; every credited piece counts, all years; no thresholds, no caps, no
    # guesses from titles. (Before, a person was tagged with their top area, a second only at half the top's count,
    # from two specialty articles up, and fields at a quarter of their articles.) The generalist policy journals the
    # taxonomy gives weight 0 say nothing about a field and count toward none (data['field_of'] tells the pages which
    # journals count). Most articles first:
    #   people[i][4] = [[area id, articles], ...]
    #   people[i][5] = [[field id, articles, [[journal id, articles], ...]], ...]
    #   people[i][6] = all their specialty-journal articles
    paper_journal = [journal_id[j] for j in first_rows.loc[paper_keys, 'journal']]
    no_field = set(tax.loc[pd.to_numeric(tax.get('weight', pd.Series(dtype=str)), errors='coerce') == 0, 'journal']) if 'weight' in tax.columns else set()
    field_of = {journal_id[j[0]]: j[3][0][0] for j in journals if j[3] and j[2] is None and j[0] not in no_field}
    field_area = {subjects.index(f): groups.index(a) for f, a in subject_to_group.items()}
    works = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for pk, person_i in zip(credit_paper, credit_person):
        f = field_of.get(paper_journal[pk])
        if f is not None:
            works[person_i][f][paper_journal[pk]] += 1
    for person_i, entry in enumerate(people):
        assert len(entry) == 4, entry[:1]
        w = works.get(person_i, {})
        n_of = {f: sum(w[f].values()) for f in w}
        fields = sorted(w, key=lambda f: (-n_of[f], subjects[f]))
        areas = defaultdict(int)
        for f in fields:
            areas[field_area[f]] += n_of[f]
        entry.append([[g, n] for g, n in sorted(areas.items(), key=lambda x: (-x[1], groups[x[0]]))])
        entry.append([[f, n_of[f], sorted(([ji, n] for ji, n in w[f].items()), key=lambda x: (-x[1], x[0]))] for f in fields])
        entry.append(int(sum(n_of.values())))
    print(f'  areas: {sum(1 for e in people if e[4])} people with specialty-journal articles, tagged with those journals\' '
          f'areas ({sum(1 for e in people if len(e[4]) > 1)} with more than one); {sum(1 for e in people if not e[4])} with none')
    os.makedirs(os.path.dirname(CREDITED_KEYS), exist_ok=True)
    with open(CREDITED_KEYS + '.tmp', 'w', encoding='utf-8') as f:   # what the classifier does next
        f.write('\n'.join(paper_keys))
    os.replace(CREDITED_KEYS + '.tmp', CREDITED_KEYS)
    credited_ids = sorted(set(credit_paper))   # (review) the papers that still have a credit, as in meta.counts
    print(f'  short pieces: {sum(short_flags[i] for i in credited_ids)} of {len(credited_ids)} credited pieces; '
          f'{sum(1 for i in credited_ids if paper_keys[i] in classes)} classified, '
          f'{sum(1 for i in credited_ids if paper_keys[i] in length_of and length_of[paper_keys[i]] == length_of[paper_keys[i]] and int(length_of[paper_keys[i]]) >= 1)} with a measured length')
    data = {
        'schools': [[s, s in us or s in aba, us.get(s, (None, None, None))[1], us.get(s, (None, None, None))[2]] for s in schools],
        # 2026-10-25 (the owner: "Add in another ranking. Use tax prof ... allow a user to select that as the source"):
        # the flagship tiers and the specialty host filter can use either source
        'rank_sources': [['usnews', 'U.S. News overall rank', us_meta['edition']]] +
                        ([['peer', 'U.S. News peer reputation rank (TaxProf Blog)', us_meta['edition']]] if us_meta.get('peer') else []),
        'journal_ranks': rank_by if us_meta.get('peer') else {'usnews': rank_by['usnews']},
        'host_ranks': host_by if us_meta.get('peer') else {'usnews': host_by['usnews']},
        'people': people,
        'subjects': subjects,
        'groups': groups,
        'journals': journals,
        'papers': {
            'journal': [journal_id[j] for j in p['journal']],
            'year': [int(y) for y in p['year']],
            'authors': [int(n_authors[k]) for k in paper_keys],
            'minor': short_flags,
            # [kind index (-1 unknown), measured length in pages (-1 unknown)] for the drop-downs' "skipped: ..." notes
            'kind': [PIECE_KINDS.index(classes[k][0]) if k in classes else -1 for k in paper_keys],
            'length': [int(length_of[k]) if k in length_of and length_of[k] == length_of[k] else -1 for k in paper_keys],
        },
        'credits': {'paper': credit_paper, 'person': credit_person},
        # per journal: the field its articles count toward on "Who works on what" and in the tags (-1: none)
        'field_of': [field_of.get(i, -1) for i in range(len(journal_names))],
        # (2026-10-27, the owner: "Add per-professor and exclude-own-review toggles to the rankings page, off by default")
        # per school, the people on its faculty list (the per-professor option divides by it); per journal, the
        # faculty-list schools that publish it (flagship_schools.csv, specialty_hosts.csv), whose own faculty's articles
        # there the "own journals" option leaves out
        'school_faculty': [int(listed.get(s, 0)) for s in schools],
        'journal_school': [sorted(school_id[x] for x in journal_schools.get(j, ()) if x in school_id) for j in journal_names],
    }

    # paper titles and links are no longer published (2026-10-24, the owner dropped them from the site): no
    # titles/*.json and no data['title_chunks']; old titles files are deleted below

    ##### when the metadata was last updated
    used = coverage[coverage['journal'].isin(journal_id)]
    roster_times = roster['collected'].dropna()
    meta = {
        'built': datetime.now().strftime('%Y-%m-%d'),
        'papers_collected': {'from': used['collected'].min(), 'to': used['collected'].max(), 'journals': int(len(used))},
        'faculty_collected': {
            'from': roster_times.min().strftime('%Y-%m-%d') if len(roster_times) else None,
            'to': roster_times.max().strftime('%Y-%m-%d') if len(roster_times) else None,
            'faculty': int(len(roster)),
            'schools': int(roster['school'].nunique()),
        },
        'us_schools': us_meta,
        'aba_check': aba_check,
        'rankings': {'source': 'Washington & Lee Law Journal Rankings', 'edition': wl_year,
                     'fetched': rankings_fetched.strftime('%Y-%m-%d')},
        'flagship_ranks': {'source': us_meta['source'], 'edition': us_meta['edition'],
                           'default_top': DEFAULT_FLAGSHIP_TOP},
        'default_view': DEFAULT_VIEW,
        'years': {'min': int(min(data['papers']['year'])), 'max': int(max(data['papers']['year']))},
        'default_to': default_to(data),
        # (review) over the papers that still have a credit: the student-note rule leaves a few with none
        'counts': {'papers': len(credited_ids), 'credits': len(credit_paper), 'faculty_with_papers': len(people),
                   'minor_papers': int(sum(1 for i in credited_ids if data['papers']['minor'][i])),
                   'classified_papers': int(sum(1 for i in credited_ids if data['papers']['kind'][i] >= 0)),
                   'measured_papers': int(sum(1 for i in credited_ids if data['papers']['length'][i] >= 1)),
                   # the pieces without a measured length that the deployed short-piece model decided (audit: the FAQ
                   # counted only the older classifier's 88)
                   'model_papers': int(sum(1 for i in credited_ids if data['papers']['length'][i] < 1 and paper_keys[i] in model_flags))},
        'piece_kinds': PIECE_KINDS,
        'short_model': model_info,
        'matching': stats,
        'group_subjects': {g: [s for s in subjects if subject_to_group[s] == g] for g in groups},
        'coverage': [{k: (None if isinstance(v, float) and v != v else v) for k, v in r.items()}
                     for r in used.sort_values('journal').to_dict(orient='records')],
    }

    # versions (see MAJOR): a hash of the substantive data, and one of the site's own files
    # (stress test, 2026-10-24) without each journal's "last checked" date: a run that finds nothing new is not a new
    # data version (the owner: changes that are not substantive don't count)
    substantive = dict(data, journals=[[j[0]] + j[2:] for j in data['journals']])
    digest = hashlib.sha1(json.dumps(substantive, sort_keys=True).encode()).hexdigest()[:12]
    site_digest = site_files_digest()
    prev = {}
    if os.path.exists(os.path.join(OUT_DIR, 'meta.json')):
        try:
            prev = json.load(open(os.path.join(OUT_DIR, 'meta.json'), encoding='utf-8'))
        except ValueError:     # a build killed while writing it (review): fall back to git's copy
            prev = git_json('docs/data/meta.json')
    now = int(time.time())
    if not prev.get('semver'):                           # the first versioned build: the owner's "version 2.0"
        semver, kind, updated = [MAJOR, 0, 0], 'data', now
    else:
        semver, updated = list(prev['semver']), prev.get('data_updated') or now
        if MAJOR != semver[0]:
            semver, kind, updated = [MAJOR, 0, 0], 'major', now
        elif prev.get('digest') != digest:
            semver, kind, updated = [semver[0], semver[1] + 1, 0], 'data', now
        elif prev.get('site_digest') != site_digest:
            semver, kind = [semver[0], semver[1], semver[2] + 1], 'site'
        else:
            kind = prev.get('kind', 'data')
    meta['semver'] = semver
    meta['version'] = '.'.join(map(str, semver))
    meta['kind'] = kind
    meta['data_updated'] = updated                       # unix time of the last substantive data change
    meta['digest'] = digest
    meta['site_digest'] = site_digest
    meta['build_hash'] = build_hash(digest, site_digest)
    history = update_history(meta, data, prev)

    for f in glob.glob(os.path.join(OUT_DIR, 'titles', '*.json')):     # titles are no longer published
        os.remove(f)
    if os.path.isdir(os.path.join(OUT_DIR, 'titles')) and not os.listdir(os.path.join(OUT_DIR, 'titles')):
        os.rmdir(os.path.join(OUT_DIR, 'titles'))
    insights = coauthorship(papers, n_authors, is_short, journals)
    insights['titles'] = title_lengths(papers, is_short, journals, paper_keys, credit_paper, credit_person, data['people'], data['schools'])
    tc = insights['titles']['counts']
    print(f"  insights: title length of {tc['measured']} of {tc['all']} titles since {TITLE_SINCE} ({tc['left_out']} left out: short, "
          f"book reviews, or a heading glued on); {tc['review_titles']} in main law reviews, {tc['school_titles']} by current faculty")
    print(f"  insights: co-authorship of {insights['pieces']} pieces in {len(journals)} journals, "
          f"{insights['years'][0]}-{insights['years'][-1]} ({insights['panel']['journals']} journals publishing since {insights['panel']['since']})")
    core, details = split_for_site(data)
    outputs = [('data.json', core), ('people.json', details), ('meta.json', meta), ('history.json', history), ('insights.json', insights)]
    beta = beta_title_areas(paper_keys, credit_paper, credit_person, groups, len(data['people']))
    if beta:
        outputs.append(('beta.json', beta))
    tree = journal_tree(groups, subjects, journals, field_of, paper_journal, [int(y) for y in p['year']],
                        credit_paper, credit_person, meta['built'], people=data['people'], schools=data['schools'],
                        host_rank=data['host_ranks']['usnews'])
    outputs.append(('taxonomy.json', tree))
    for name, obj in outputs:
        with open(os.path.join(OUT_DIR, name) + '.tmp', 'w', encoding='utf-8') as f:   # temp + rename (review)
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        os.replace(os.path.join(OUT_DIR, name) + '.tmp', os.path.join(OUT_DIR, name))
        print(f'  wrote docs/data/{name} ({os.path.getsize(os.path.join(OUT_DIR, name)) / 1e6:.1f} MB)')
    print('  papers', meta['counts']['papers'], '| credits', meta['counts']['credits'],
          '| faculty with papers', meta['counts']['faculty_with_papers'],
          '| articles collected', meta['papers_collected']['from'], 'to', meta['papers_collected']['to'])
    return meta


def site_files_digest():
    '''a hash of the site's own files (SITE_FILES: its pages, scripts and styles), for the patch number'''
    site = hashlib.sha1()
    for f in sorted(f for pat in SITE_FILES for f in glob.glob(os.path.join(HERE, pat))):
        with open(f, 'rb') as fh:
            site.update(os.path.basename(f).encode() + b'\0' + fh.read())
    return site.hexdigest()[:12]


def write_json_atomic(path, obj):
    with open(path + '.tmp', 'w', encoding='utf-8') as f:      # temp + rename (review)
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)


def build_hash(digest, site_digest):
    '''(2026-10-26, the owner: "make the build version not a timestamp but a smaller-tech-looking build hash") seven hex
    characters for this build, from the data's fingerprint and the site files' together, like a short git hash'''
    return hashlib.sha1(f'{digest}:{site_digest}'.encode()).hexdigest()[:7]


def site_version():
    """python build_data.py --site-version: a new patch number for a change to the site's own files alone, without
    rebuilding the data (audit, 2026-10-25: the owner's rule, "any change at all" moves the last number, but only a
    full build moved it, so site-only commits went out under the old number with a stale site digest). Run it before
    committing a change to docs/*.html, *.js or *.css. Nothing changed: nothing is written."""
    meta_path, history_path = os.path.join(OUT_DIR, 'meta.json'), os.path.join(OUT_DIR, 'history.json')
    with open(meta_path, encoding='utf-8') as f:
        meta = json.load(f)
    site_digest = site_files_digest()
    if meta.get('site_digest') == site_digest:
        print(f"site files unchanged (site digest {site_digest}); still version {meta.get('version')}")
        return meta
    with open(history_path, encoding='utf-8') as f:
        history = json.load(f)
    semver = list(meta['semver'])
    semver[2] += 1
    version = '.'.join(map(str, semver))
    entry = dict(history[-1]) if history else {}
    # the data are the same as the last version's: its entry, with the new number and no changes (history.html reads
    # changes.moved, so the keys are there, empty)
    entry.update(version=version, kind='site', date=datetime.now().strftime('%Y-%m-%d'),
                 hash=build_hash(meta.get('digest', ''), site_digest), changes={'papers': 0, 'faculty_with_papers': 0, 'moved': []})
    if history and history[-1].get('version') == version:      # a run stopped between the two writes below
        history[-1] = entry
    else:
        history.append(entry)
    old = meta.get('version')
    meta.update(semver=semver, version=version, kind='site', site_digest=site_digest, build_hash=entry['hash'], history_entry=entry)
    write_json_atomic(history_path, history)
    write_json_atomic(meta_path, meta)
    print(f'site files changed (site digest {site_digest}): version {old} -> {version}; wrote meta.json and history.json')
    return meta


def publish(meta):
    e = meta.get('history_entry', {})
    ch = e.get('changes', {})
    what = {'data': 'data update', 'site': 'site update', 'major': 'major update'}.get(meta.get('kind'), 'update')
    msg = (f"Version {meta['version']}: {what} {meta['built']}\n\n"
           f"articles collected {meta['papers_collected']['from']} to {meta['papers_collected']['to']}; "
           f"faculty lists {meta['faculty_collected']['from']} to {meta['faculty_collected']['to']}; "
           f"W&L {meta['rankings']['edition']}\n"
           f"papers {meta['counts']['papers']} ({ch.get('papers', 0):+d}), "
           f"faculty with papers {meta['counts']['faculty_with_papers']} ({ch.get('faculty_with_papers', 0):+d}), "
           + ("the default view changed, so its top 30 is not compared" if ch.get('view_changed')
              else f"{len(ch.get('moved', []))} of the default top 30 moved"))
    # only docs/ is committed (other staged or changed files in the repo stay as they are); git never waits
    # for a password prompt; a push that failed last time is retried even when there is nothing new
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    # (stress test, 2026-10-24) every git call has a time limit: a push that connected and then stalled held the build,
    # the whole run and its lock forever
    def git(*a, timeout=300, **k):
        try:
            return subprocess.run(['git', *a], cwd=HERE, env=env, timeout=timeout, **k)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f'git {a[0]} took more than {timeout // 60} minutes; stopped (the commit, if any, is '
                               f'kept locally and goes out with the next run)')
    paths = ['docs', 'faculty']       # the data, the page code that reads it, the faculty list the build used
    git('add', *paths, check=True)
    if git('diff', '--cached', '--quiet', '--', *paths).returncode != 0:
        git('commit', '-m', msg, '--', *paths, check=True)
    else:
        print('no data changes to publish')
    # (stress test, 2026-10-24) GitHub can have commits this copy lacks (a merged pull request to faculty/edits.csv):
    # every push was then rejected, for good. Bring them in first (other local edits are set aside and put back).
    if git('fetch', '--quiet', 'origin').returncode == 0:
        behind = git('rev-list', '--count', 'HEAD..@{upstream}', capture_output=True, text=True)
        if behind.returncode == 0 and behind.stdout.strip() not in ('', '0'):
            print(f'  GitHub has {behind.stdout.strip()} commit(s) this copy lacks (a merged pull request?); rebasing onto them')
            if git('rebase', '--autostash', '@{upstream}').returncode != 0:
                git('rebase', '--abort')
                raise RuntimeError('could not put this update on top of GitHub\'s newer commits (a conflict); '
                                   'resolve by hand with git pull --rebase in LAWrankings/lawSchoolRankings')
    ahead = git('rev-list', '--count', '@{upstream}..HEAD', capture_output=True, text=True)
    if ahead.returncode == 0 and ahead.stdout.strip() == '0':
        return
    for attempt in range(3):
        if git('push').returncode == 0:
            return
        print(f'git push failed ({attempt + 1}/3); trying again in a minute')
        time.sleep(60)
    raise RuntimeError('git push failed three times; the commit is saved locally and goes out with the next run')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='build docs/data for the static rankings site')
    parser.add_argument('--publish', action='store_true', help='git commit + push docs/ after building')
    parser.add_argument('--site-version', action='store_true',
                        help='only the site files changed: bump the patch number in docs/data/meta.json and history.json '
                             'without rebuilding the data (audit, 2026-10-25)')
    args = parser.parse_args()
    meta = site_version() if args.site_version else build()
    if args.publish:
        publish(meta)
