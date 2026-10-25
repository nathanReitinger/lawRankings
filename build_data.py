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
from collections import defaultdict
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
TAXONOMY_FILE = os.path.join(SOURCE_DIR, 'journal_taxonomy.csv')     # 2026-10-25: specialty journal -> area > field > topic
SPECIALTY_HOSTS = os.path.join(SOURCE_DIR, 'specialty_hosts.csv')    # 2026-10-25: specialty journal -> host law school
WL_CROSSWALK = os.path.join(SOURCE_DIR, 'wl_subject_taxonomy.csv')    # W&L subject -> area > field, for journals not mapped yet
# the order the areas are listed in (research/taxonomy: 13 subject areas, then the methods)
AREA_ORDER = ['Constitutional & Public Law', 'Courts, Litigation & Dispute Resolution', 'Criminal Law & Justice',
              'Business & Financial Law', 'Tax, Trusts & Estates', 'Property, Environment & Natural Resources',
              'International & Comparative Law', 'Science, Technology & IP', 'Health Law & Bioethics',
              'Civil Rights, Equality & Family', 'Labor & Employment', 'Legal Profession & Education',
              'Legal Theory, Humanities & Society', 'Interdisciplinary Methods']
DEFAULT_FLAGSHIP_TOP = 25     # the site's default view: main law reviews of the US News top 25 (tiers 1-3 and 4-25)
DEFAULT_VIEW = f'flagship law reviews of the US News top {DEFAULT_FLAGSHIP_TOP} schools, last ten years, US law schools'


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
    if ',' in name:
        last, rest = name.split(',', 1)
    else:
        last, rest = name, ''
    # 2026-10-23 (stress tests t7, t14, t17): accents folded (José = Jose), letters of any script kept (an all-CJK
    # name no longer becomes ""), hyphens and apostrophes joined (Smith-Jones = Smith Jones, O'Brien = OBrien),
    # a suffix is found wherever it is ("Skeel Jr., David" = "Skeel, David Jr.") and kept with the last name as
    # "skeel|jr", so Robert L. Jones and Robert L. Jones Jr. stay two people (match_authors can still match a
    # paper that leaves the suffix off)
    fold = lambda s: ''.join(c for c in unicodedata.normalize('NFKD', s.lower()) if not unicodedata.combining(c))
    words = lambda s: re.sub(r'[^\w ]', ' ', re.sub(r"[-'’]", '', fold(s))).split()
    suffix = next((p for p in words(last) + words(rest) if p in NAME_SUFFIXES), '')
    last = ''.join(p for p in words(last) if p not in NAME_SUFFIXES) + ('|' + suffix if suffix else '')
    parts = [p for p in words(rest) if p not in NAME_SUFFIXES]
    first = parts[0] if parts else ''
    middle = ' '.join(parts[1:])
    return last, first, middle


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
        df = df[df['title_key'] != '']
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
            'verified': bool(state.get('verified_at')),
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


def load_school_csvs():
    """HeinOnline's per-school faculty CSV, in faculty_runs/school_csv/<school>.csv (index.json there names the school
    each file is for) and, in the older layout, faculty_runs/<pass>.csv_metric/. Every file is read, oldest download first, so the newest wins. Returns
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
    for _, f, named in sorted(files):            # oldest download first
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
            site = str(r.get('website', '')).strip()
            out[(school, key)] = {'website': site if re.match(r'https?://', site) else '', 'title': str(r.get('title', '')).strip(),
                                  'orcid': str(r.get('ORCID', '')).strip(), 'school': school}
            schools.add(school)
    return out, schools


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
        'hein_profile': roster['hein_name'].map(hein_profile_link),
        'source': roster['run'],
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

    parsed = df['link'].map(parse_hein_name)
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


def match_by_name(papers, roster, rows=None):
    '''the name rules: paper author link -> roster row indexes (a person listed at two schools gets both), using only
    the roster rows `rows` (default: all). Also returns counts, how each link was decided, and the roster rows each
    uncertain decision involved (credited on a differing name, or held back as unsure).'''
    full = defaultdict(list)
    short = defaultdict(list)
    no_suffix = defaultdict(list)
    for i, r in roster.iterrows():
        if rows is not None and i not in rows:
            continue
        full[(r['last'], r['first'], r['middle'])].append(i)
        short[(r['last'], r['first'])].append(i)
        no_suffix[(r['last'].split('|')[0], r['first'])].append(i)

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
        if m:
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
        elif len(people) == 1:
            decide(link, how, cands, unsure=cands)
        elif len(people) > 1:
            decide(link, 'ambiguous', unsure=cands)
        else:
            decide(link, 'not_faculty')
    return to_ret, dict(stats), how_of, unsure_rows


def same_school(a, b):
    """two names of one school, as Hein writes them on profiles and school lists ("Brigham Young University" /
    "Brigham Young University Law School")"""
    return bool(a) and bool(b) and (a == b or school_norm(a) == school_norm(b))


def match_authors(papers, roster):
    """paper author link -> roster row indexes (a person listed at two schools gets both).

    2026-10-24 (the owner: "the name match should come from hein url. we can use the way they resolved to figure out
    how we should resolve it ... one author should have one URL reference"): one faculty member = one Hein profile
    link (search_name). Where we have read that profile (hein_profiles.py), Hein's own set of name forms for the person
    decides: a paper is theirs when its author form is in the set, and the name rules no longer give them papers.
    Faculty whose profile has not been read yet are matched by the name rules (match_by_name), as before.

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
    profiles = hp.load_good()
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
    by_name, name_stats, name_how, unsure_rows = match_by_name(papers, roster)          # every faculty member
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
                to_ret[link] = rows_of[next(iter(claim))]
                stats['hein_profile'] += 1
            elif len(named) == 1:
                to_ret[link] = rows_of[next(iter(named))]
                stats['hein_profile_own_name'] += 1
            else:
                stats['hein_profiles_share_name'] += 1
            continue
        if x in rows_of and x not in profiled and link in fallback:
            # an unprofiled faculty member's own listed name (review: a profiled person's punctuation twin took it)
            to_ret[link] = fallback[link]
            stats['name_rules_own_name'] += 1
            continue
        close = near.get(parsed, set())
        if close:
            # the name Hein lists for them, written with other punctuation ("Huq, A. Z" / "Huq, A.Z."); a faculty
            # member without a profile who has that very name too makes it two people: not credited
            k = sorted(close)[0]
            joined_only = not parsed[2] and all(joined_prefix(raw_last(link), r) for kk, r in near_raw[parsed] if kk == k)
            namesake = link in fallback and name_how.get(link) == 'exact'    # an unprofiled person with this name
            if len(close) == 1 and not namesake and not joined_only:
                to_ret[link] = rows_of[k]
                stats['hein_profile_punctuation'] += 1
            elif joined_only:
                stats['joined_name_unsure'] += 1
            else:
                stats['hein_profile_namesakes'] += 1
            continue
        how = name_how.get(link, 'not_faculty')
        if link in fallback:
            to_ret[link] = fallback[link]
            stats['name_rules_' + how] += 1
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
        print(f'  Hein profiles: read for {len(profiled)} of {len(rows_of)} faculty. For them, Hein and the name rules '
              f'agree on {agree} author spellings; Hein adds {len(added)} ({sum(c["rows"] for c in added)} paper rows) '
              f'and drops {len(dropped)} ({sum(c["rows"] for c in dropped)} paper rows)')
        os.makedirs(hp.DIR, exist_ok=True)
        pd.DataFrame(changes, columns=['change', 'faculty', 'school', 'paper_author', 'name_rule', 'rows', 'link', 'person']) \
            .drop(columns=['link', 'person']).sort_values(['change', 'rows'], ascending=[True, False]) \
            .to_csv(os.path.join(hp.DIR, 'changes_from_name_rules.csv'), index=False)
        record_unexplained([c for c in changes if c['change'].startswith('dropped')], papers)
    return to_ret, dict(stats), {'pk': pk, 'rows_of': rows_of, 'profiled': profiled, 'profiles': usable,
                                 'mismatched': mismatched, 'all_profiles': profiles,
                                 'by_name': by_name, 'unsure_rows': unsure_rows}


def record_unexplained(dropped, papers):
    """PATCH 16 (review): spellings the name rules give a profiled person that their profile does not list, with when
    each was first seen (when its earliest row was collected), merged into hein_profiles/unexplained.json. The next update refreshes such a
    profile again RECHECK_DAYS later if the spelling turned up after the profile was read; once it has been read
    again, the same spelling never triggers another read (hein_profiles.due)."""
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
    names = list(dict.fromkeys(hp.search_name(roster.at[i, 'link']) for i in order))
    os.makedirs(hp.DIR, exist_ok=True)
    with open(hp.WANTED + '.tmp', 'w', encoding='utf-8') as f:
        f.write('\n'.join(n for n in names if n.strip()) + '\n')
    os.replace(hp.WANTED + '.tmp', hp.WANTED)
    os.makedirs(os.path.dirname(FACULTY_PRIORITY), exist_ok=True)
    with open(FACULTY_PRIORITY + '.tmp', 'w', encoding='utf-8') as f:
        f.write('\n'.join(sorted(s for s in roster['school'].unique() if s in us_schools)) + '\n')
    os.replace(FACULTY_PRIORITY + '.tmp', FACULTY_PRIORITY)
    todo = hp.due(hp.load(), names)
    print(f'  wrote hein_profiles/wanted.txt: {len(names)} faculty, {len(todo)} profiles still to read')
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
    (inferring the URL, or a search by hand). school_csv_read says whether Hein's CSV for their school has been read
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


def default_ranking(data, years=10, top=30):
    '''the site's default view in Python (DEFAULT_VIEW): main law reviews of the US News top 25, last `years`
    years, US law schools'''
    last = min(datetime.now().year, max(data['papers']['year']))   # the site's own default window (app.js)
    journals = {i for i, j in enumerate(data['journals']) if j[2] and 1 <= j[2] <= DEFAULT_FLAGSHIP_TOP}
    score, faculty = defaultdict(float), defaultdict(set)
    P = data['papers']
    for p, person in zip(data['credits']['paper'], data['credits']['person']):
        if P['journal'][p] in journals and last - years <= P['year'][p] <= last:
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


PANEL_SINCE = 1980     # insights: "the same journals throughout" = journals with articles in every five years since


def coauthorship(papers, n_authors, is_short, journals):
    '''docs/data/insights.json for the Insights page (2026-10-25, the owner: "co-authorship used to happen less and
    today it is happening more"): per year and kind of journal, how many pieces had 1, 2, 3, 4+ authors. Every piece in
    every collected journal counts, whoever wrote it (not only current faculty, so the trend is not about who is on
    a faculty today). Kinds: flagship law reviews, online editions and other general journals, specialty journals.
    Each count also for research articles only (short pieces left out, as on the rankings page) and for the "panel":
    journals with articles in every five years since PANEL_SINCE, so a trend is not just new journals coming in.'''
    kind_of = {j[0]: ('specialty' if j[2] is None else 'online' if j[2] < 0 else 'flagship') for j in journals}
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
        'papers_collected': meta['papers_collected'], 'faculty_collected': meta['faculty_collected'],
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
    # journals fit that category"): specialty journals are grouped by the taxonomy (journal_taxonomy.csv: each
    # journal's primary area > field, from research/taxonomy plus hand-mapped additions): areas are the groups,
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
    # a journal not mapped by name takes the field of its best W&L subject (wl_subject_taxonomy.csv); a W&L subject
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
        print(f'  {by_subject} specialty journals placed by their W&L subject (not in journal_taxonomy.csv yet)')
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
                host = [school, (lab or 'Unranked') if school else '', 'specialty', publisher]
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
    info['page'] = papers.groupby('paper_key')['raw'].first().str.extract(r'\bPage (\S+)')[0].fillna('')
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
                if info.at[k, 'page'] == info.at[first, 'page']:     # same page too: listed twice
                    same[k], within = first, within + 1
            elif (info.at[first, 'journal'], *sorted([v1, v2])) in wholesale:
                same[k], across = first, across + 1
    if same:
        print(f'  {across} papers listed twice by Hein in the same year (two volume numbers) and {within} listed twice '
              f'in one volume; counted once')
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
    matched, stats, match_info = match_authors(papers, roster)
    print('  author matching:', stats)
    write_profile_wants(papers, roster, set(us) | set(aba), match_info)

    credited = papers[papers['author'].isin(matched)].copy()
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

    # Faculty tags (the owner, 2026-10-23: "a separate computation"): where each person publishes among the specialty
    # journals, over all their articles and all years, whatever the site's filters. An article in a journal that sits
    # in several groups counts a share toward each. The top group is a tag; so is the second when it is at least half
    # the top. Two specialty articles at least; flagship law reviews are not a tag (nearly everyone publishes there).
    journal_groups = {journal_id[j[0]]: sorted({g for g, _ in j[4]}) for j in journals}
    weight = defaultdict(lambda: defaultdict(float))
    for pk, person_i in zip(credit_paper, credit_person):
        gs = journal_groups.get(journal_id[first_rows.at[paper_keys[pk], 'journal']], [])
        for g in gs:
            weight[person_i][g] += 1 / len(gs)
    tagged = 0
    for person_i, w in weight.items():
        ranked_groups = sorted(w, key=lambda g: (-w[g], g))
        if sum(w.values()) < 2:
            continue
        tags = [ranked_groups[0]] + [g for g in ranked_groups[1:2] if w[g] >= 0.5 * w[ranked_groups[0]]]
        people[person_i].append(tags)
        tagged += 1
    for person_entry in people:
        if len(person_entry) < 5:
            person_entry.append([])
    print(f'  faculty tags: {tagged} people tagged by where they publish among specialty journals')

    p = first_rows.loc[paper_keys]
    classes = load_classes()
    model_flags, model_info = load_short_model()
    def is_short(k):
        length = length_of.get(k)
        kind, pages, llm_short = classes.get(k, (None, None, False))
        if length is not None and length == length and length >= 1:
            return length < SHORT_PAGES or (kind == 'memorial or tribute' and length < 20)
        if k in model_flags:
            return bool(model_flags[k])    # the trained model's call where the length is not measured
        return bool(llm_short)             # an older classifier's call; neither: it counts
    short_flags = [1 if is_short(k) else 0 for k in paper_keys]
    os.makedirs(os.path.dirname(CREDITED_KEYS), exist_ok=True)
    with open(CREDITED_KEYS + '.tmp', 'w', encoding='utf-8') as f:   # what the classifier does next
        f.write('\n'.join(paper_keys))
    os.replace(CREDITED_KEYS + '.tmp', CREDITED_KEYS)
    print(f'  short pieces: {sum(short_flags)} of {len(paper_keys)} credited pieces; '
          f'{sum(1 for k in paper_keys if k in classes)} classified, '
          f'{sum(1 for k in paper_keys if length_of.get(k) == length_of.get(k) and length_of.get(k) is not None)} with a measured length')
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
    }

    # paper titles and links are no longer published (2026-10-24, the owner dropped them from the site): no
    # titles/*.json and no data['title_chunks']; old titles files are deleted below

    ##### when was everything grabbed
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
        'counts': {'papers': len(paper_keys), 'credits': len(credit_paper), 'faculty_with_papers': len(people),
                   'minor_papers': int(sum(1 for m in data['papers']['minor'] if m)),
                   'classified_papers': int(sum(1 for k in data['papers']['kind'] if k >= 0)),
                   'measured_papers': int(sum(1 for k in data['papers']['length'] if k >= 0)),
                   # the pieces without a measured length that the deployed short-piece model decided (audit: the FAQ
                   # counted only the older classifier's 88)
                   'model_papers': int(sum(1 for k, n in zip(paper_keys, data['papers']['length']) if n < 0 and k in model_flags))},
        'piece_kinds': PIECE_KINDS,
        'short_model': model_info,
        'matching': stats,
        # faculty whose Hein author profile has been read (their articles matched by Hein's own name forms)
        'hein_profiles': {'read': len(match_info['profiled']), 'faculty': len(match_info['rows_of'])},
        'group_subjects': {g: [s for s in subjects if subject_to_group[s] == g] for g in groups},
        'coverage': [{k: (None if isinstance(v, float) and v != v else v) for k, v in r.items()}
                     for r in used.sort_values('journal').to_dict(orient='records')],
    }

    # versions (see MAJOR): a hash of the substantive data, and one of the site's own files
    # (stress test, 2026-10-24) without each journal's "last checked" date: a run that finds nothing new is not a new
    # data version (the owner: changes that are not substantive don't count)
    substantive = dict(data, journals=[[j[0]] + j[2:] for j in data['journals']])
    digest = hashlib.sha1(json.dumps(substantive, sort_keys=True).encode()).hexdigest()[:12]
    site = hashlib.sha1()
    for f in sorted(f for pat in SITE_FILES for f in glob.glob(os.path.join(HERE, pat))):
        site.update(os.path.basename(f).encode() + b'\0' + open(f, 'rb').read())
    site_digest = site.hexdigest()[:12]
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
    history = update_history(meta, data, prev)

    for f in glob.glob(os.path.join(OUT_DIR, 'titles', '*.json')):     # titles are no longer published
        os.remove(f)
    if os.path.isdir(os.path.join(OUT_DIR, 'titles')) and not os.listdir(os.path.join(OUT_DIR, 'titles')):
        os.rmdir(os.path.join(OUT_DIR, 'titles'))
    insights = coauthorship(papers, n_authors, is_short, journals)
    print(f"  insights: co-authorship of {insights['pieces']} pieces in {len(journals)} journals, "
          f"{insights['years'][0]}-{insights['years'][-1]} ({insights['panel']['journals']} journals publishing since {insights['panel']['since']})")
    outputs = [('data.json', data), ('meta.json', meta), ('history.json', history), ('insights.json', insights)]
    tree = subject_tree()
    if tree:
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
           f"{len(ch.get('moved', []))} of the default top 30 moved")
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
    args = parser.parse_args()
    meta = build()
    if args.publish:
        publish(meta)
