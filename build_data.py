'''
build the data files for the static site (docs/) from whatever the update scripts in ../../main.py left behind

1. papers per journal      journal_store/ (get_papers; see journal_store.py, the repaired incremental store)
2. faculty per school      faculty_runs/ (get_authors_from_v3, Hein AuthorBySchool), older authors_latest.csv
3. journal ranks           newest rankings_<year>.csv (update_WandL, Washington & Lee): specialty journals
4. US law school list      newest usnews_<edition>.csv (update_usnews), else the hand-saved 2025_USnews.txt, plus
                           the ABA-approved list aba_schools_<year>.csv (update_aba_schools), checked against Hein;
                           also ranks the flagship law reviews (each school's main review gets its school's rank)
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
import subprocess
import time
import unicodedata
from collections import defaultdict
from datetime import datetime
from urllib.parse import urlparse, parse_qs, unquote

import sys

import pandas as pd
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(HERE, 'docs', 'data')

sys.path.insert(0, SOURCE_DIR)
import journal_store as js   # noqa: E402  (shared volume keys, years and author keys with the update script)
js.STORE_DIR = os.path.join(SOURCE_DIR, 'journal_store')

VERSION = 2   # shown on the site as "Volume 2"; each data change bumps the build number

# Flagship law reviews (W&L's General category) are ranked by the US News rank of the school that publishes
# them; specialty journals by their W&L rank. This file says which school publishes each General journal and
# whether it is that school's main law review ("main"), an online edition ("online"), a second general journal
# ("secondary"), or not a school's journal ("non_school", "foreign"). Only main reviews get a US News rank.
FLAGSHIP_FILE = os.path.join(SOURCE_DIR, 'flagship_schools.csv')
DEFAULT_FLAGSHIP_TOP = 25     # the site's default view: main law reviews of the US News top 25 (tiers 1-3 and 4-25)
DEFAULT_VIEW = f'flagship law reviews of the US News top {DEFAULT_FLAGSHIP_TOP} schools, last ten years, US law schools'

# W&L subjects -> the simpler groups shown on the site. Edit freely; anything not listed lands in "Other".
SUBJECT_GROUPS = {
    'Business & Tax': [
        'Business, Corporations and Securities Law', 'Banking, Finance and Insurance Law', 'Bankruptcy',
        'Commercial and Competition Law', 'Taxation', 'Law and Economics', 'International Trade',
        'Estates and Trusts', 'Employment Law',
    ],
    'Constitutional & Public Law': [
        'Constitutional Law', 'Administrative Law', 'Governmental Law', 'Legislation',
        'Public Policy, Politics and the Law', 'Education Law',
        'War, Conflicts, Military and National Security Law',
    ],
    'Criminal Law & Litigation': [
        'Criminal Law', 'Criminology and Law Enforcement', 'Evidence and Procedure',
        'Civil Litigation and Dispute Resolution', 'Torts',
    ],
    'International & Comparative': [
        'International Law', 'Comparative Law', 'Asian Law', 'European Law',
        'Maritime and Transportation Law', 'Air and Space Law',
    ],
    'Technology & IP': [
        'Science, Technology and Computing Law', 'Intellectual Property', 'Communications and Media Law',
        'Arts, Entertainment and Sports Law',
    ],
    'Environment & Property': [
        'Environmental and Land Use Law', 'Energy and Natural Resources Law', 'Agriculture Law', 'Animal Law',
        'Property, Real Estate and Construction Law',
    ],
    'Civil Rights & Social Justice': [
        'Civil Rights and Social Justice', 'Gender, Women and Sexuality and Law',
        'Minority, Race and Ethnic Issues and Law', 'Human Rights and Immigration Law',
    ],
    'Health & Family': [
        'Health, Medicine, Psychology and Psychiatry Law', 'Family and Juvenile Law', 'Elder Law',
    ],
    'Theory & the Profession': [
        'Jurisprudence and Legal Theory', 'Social Sciences and Law', 'Legal History', 'Law and Ethics',
        'Law and Religion and Religious Legal Systems', 'Legal Profession and Legal Education',
        'Legal Research, Writing and Librarianship',
    ],
}

# short pieces: a rough title guess the site's beta "Skip short pieces" box uses until the classifier
# (Ollama model over title, section label, position, pages) replaces it; flagged, not dropped
MINOR_TITLE = re.compile(
    r'\b(foreword|afterword|preface|prologue|epilogue|in memoriam|tribute|dedication|eulogy|remembering'
    r'|book reviews?|remarks|keynote|panel|transcript|roundtable|response|reply|rejoinder|errat(um|a))\b'
    r'|^(an? )?introduction\b',
    re.IGNORECASE,
)

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


def middles_compatible(a, b):
    return not a or not b or a[0] == b[0]


################################################ inputs

def infer_year(volume):
    return js.infer_year(volume)


def load_papers():
    '''every journal in journal_store/, plus when each was last checked'''
    rows, coverage = [], []
    for f in sorted(glob.glob(os.path.join(SOURCE_DIR, js.STORE_DIR, 'j___*.csv'))):
        journal = os.path.basename(f)[len('j___'):-len('.csv')]
        df, state = js.load_store(journal)     # each volume's current copy (the update script appends new copies)
        df = df[(df['title'] != '') & (df['author'] != '')].copy()
        if df.empty:
            continue
        df['title_key'] = df['title'].map(js.title_key)
        df['author_key'] = df['author'].map(js.author_key)
        df = df[df['title_key'] != '']
        df['journal'] = journal
        df['year'] = df['volume'].map(infer_year)
        rows.append(df)
        vols = state.get('volumes', {})
        newest_volume = max((v.get('collected_at') or '' for v in vols.values()), default='')
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


def load_roster():
    '''newest faculty list for each school, from get_authors_from_v3 runs (faculty_runs/) and the older authors_latest.csv'''
    sources = []   # oldest first
    old = os.path.join(SOURCE_DIR, 'authors_latest.csv')
    if os.path.exists(old):
        sources.append(('authors_latest', pd.read_csv(old).rename(columns={'name': 'author'}), True))
    for f in sorted(glob.glob(os.path.join(SOURCE_DIR, 'faculty_runs', 'authors_*.csv'))):
        run = os.path.basename(f)[:-len('.csv')]
        complete = os.path.exists(f[:-len('.csv')] + '.done')
        sources.append((run, pd.read_csv(f), complete))

    # the newest finished run decides which schools exist (Hein drops schools too);
    # runs after it are still in progress and replace the lists for the schools they reached
    last_done = max([i for i, s in enumerate(sources) if s[2]], default=0)
    keep = set()
    for _, df, _ in sources[last_done:]:
        keep |= set(df['school'])
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
    # 2026-10-23 (stress test t15): a crash between a school's rows and its progress line writes them twice
    df = df.drop_duplicates(['school', 'link']).reset_index(drop=True)

    parsed = df['link'].map(parse_hein_name)
    df['last'] = parsed.map(lambda p: p[0])
    df['first'] = parsed.map(lambda p: p[1])
    df['middle'] = parsed.map(lambda p: p[2])
    # 2026-10-23 (stress test t9 g): a person who moved shows up at the old school (an older list) and the new one
    # (a newer list, e.g. a run in progress); only the newest list that names them counts. People listed at two
    # schools in the same list (joint appointments) keep both.
    order = {run: i for i, (run, _, _) in enumerate(sources)}
    df['_run'] = df['run'].map(order)
    newest_run = df.groupby(['last', 'first', 'middle'])['_run'].transform('max')
    moved = df[df['_run'] < newest_run]
    if len(moved):
        print(f'  {len(moved)} faculty listings dropped: the person is on a newer list at another school')
    df = df[df['_run'] == newest_run].drop(columns='_run').reset_index(drop=True)
    df['hein_name'] = df['link'].map(lambda u: unquote(parse_qs(urlparse(str(u)).query).get('search_name', [''])[0]).strip())
    stamped = pd.to_datetime(df['collected_at'], errors='coerce') if 'collected_at' in df.columns else pd.Series(pd.NaT, index=df.index)
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
        return edition, source, out
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
        edition, source, table = found
    else:
        # nothing from update_usnews() yet: the hand-saved page this project started with
        edition, source, table = '2025-2026', 'US News 2025-2026 (saved page)', {}
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
            to_ret.setdefault(h, (us_name, rank))
    unmatched = [n for n in table if not any(v[0] == n for v in to_ret.values())]
    if unmatched:
        print(f'  {len(unmatched)} {source} schools not on Hein\'s faculty lists:', unmatched[:8])
    return to_ret, {'edition': edition, 'source': source, 'schools': len(to_ret)}, table


def load_flagship(general_journals, usnews):
    '''journal -> [US News rank number (0 = unranked, -1 = not a main law review), [school, rank label, kind,
    parent journal]] for every W&L General journal, from FLAGSHIP_FILE and the US News list in use'''
    df = pd.read_csv(FLAGSHIP_FILE, dtype=str).fillna('')
    rows = {r['journal']: r for _, r in df.iterrows()}
    out = {}
    for j in general_journals:
        r = rows.get(j)
        if r is None:
            print('  !! W&L General journal not in flagship_schools.csv, counted with the other general journals:', j)
            out[j] = [-1, ['', '', 'unmapped', '']]
            continue
        school, kind = r['host_school_usnews_name'], r['kind']
        if kind != 'main':
            out[j] = [-1, [school, '', kind, r.get('parent_journal', '')]]
            continue
        if school and school not in usnews:
            print(f'  !! {j}: school "{school}" is not in the US News list in use; counted as unranked')
        label = usnews.get(school)          # "14", "175-194", or None (Unranked)
        out[j] = [int(re.match(r'\d+', label).group()) if label else 0, [school, label or 'Unranked', kind, '']]
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
    '''ABA-approved law schools (newest aba_schools_<year>.csv, written by update_aba_schools() in main.py) matched to
    the schools on Hein's faculty lists: (roster school -> ABA name, check results for meta.json). The check is the
    point: every ABA-approved school should be on Hein's faculty lists, or the site is missing a school.'''
    files = sorted(glob.glob(os.path.join(SOURCE_DIR, 'aba_schools_[0-9][0-9][0-9][0-9].csv')))
    if not files:
        print('  !! no aba_schools_<year>.csv yet (run main.py); skipping the ABA school check')
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
              f'(add a line to aba_aliases.csv if Hein uses another name):', missing)
    return to_ret, {'year': year, 'schools': len(aba), 'on_hein': len(to_ret), 'missing': missing}


################################################ build

def match_authors(papers, roster):
    '''paper author link -> list of roster row indexes (a person listed at two schools gets both)'''
    full = defaultdict(list)
    short = defaultdict(list)
    no_suffix = defaultdict(list)
    for i, r in roster.iterrows():
        full[(r['last'], r['first'], r['middle'])].append(i)
        short[(r['last'], r['first'])].append(i)
        no_suffix[(r['last'].split('|')[0], r['first'])].append(i)

    to_ret = {}
    stats = defaultdict(int)
    for link in papers['author'].unique():
        last, first, middle = parse_hein_name(link)
        if (last, first, middle) in full:
            to_ret[link] = full[(last, first, middle)]
            stats['exact'] += 1
            continue
        # match on first + last and ignore the middle name (Mayer, Connie vs Mayer, Connie Marlene),
        # but only when the first + last is one person and the middle initials don't conflict
        cands = [i for i in short.get((last, first), []) if middles_compatible(middle, roster.at[i, 'middle'])]
        people = {(roster.at[i, 'last'], roster.at[i, 'first'], roster.at[i, 'middle']) for i in cands}
        how = 'first_last'
        if not people:
            # a paper that adds or leaves off "Jr." etc.: only when the name without it is one person
            cands = [i for i in no_suffix.get((last.split('|')[0], first), []) if middles_compatible(middle, roster.at[i, 'middle'])]
            people = {(roster.at[i, 'last'], roster.at[i, 'first'], roster.at[i, 'middle']) for i in cands}
            how = 'suffix_differs'
        if len(people) == 1:
            to_ret[link] = cands
            stats[how] += 1
        elif len(people) > 1:
            stats['ambiguous'] += 1
        else:
            stats['not_faculty'] += 1
    return to_ret, dict(stats)


def default_ranking(data, years=10, top=30):
    '''the site's default view in Python (DEFAULT_VIEW): main law reviews of the US News top 25, last `years`
    years, US law schools'''
    last = max(data['papers']['year'])
    journals = {i for i, j in enumerate(data['journals']) if j[2] and 1 <= j[2] <= DEFAULT_FLAGSHIP_TOP}
    score, faculty = defaultdict(float), defaultdict(set)
    P = data['papers']
    for p, person in zip(data['credits']['paper'], data['credits']['person']):
        if P['journal'][p] in journals and last - years <= P['year'][p] <= last:
            for s in data['people'][person][1]:
                if data['schools'][s][1]:
                    score[s] += 1 / P['authors'][p]
                    faculty[s].add(person)
    order = sorted(score, key=lambda s: (-score[s], data['schools'][s][0]))[:top]
    return [[data['schools'][s][0], round(score[s] + 1, 1), len(faculty[s])] for s in order]


def update_history(meta, data, prev):
    '''docs/data/history.json: one entry per build, so changes between builds can be seen on the site'''
    path = os.path.join(OUT_DIR, 'history.json')
    history = []
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            history = json.load(f)
    entry = {
        'build': meta['build'], 'version': meta['version'], 'date': meta['built'],
        'papers_collected': meta['papers_collected'], 'faculty_collected': meta['faculty_collected'],
        'rankings_edition': meta['rankings']['edition'], 'us_schools': meta.get('us_schools'),
        'flagship_ranks': meta['flagship_ranks'], 'default_view': meta['default_view'],
        'counts': meta['counts'], 'top': default_ranking(data),
    }
    if history and history[-1]['build'] == meta['build']:
        # same data as the last build: refresh its entry, keep the number and what changed in that build
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
    print('reading collections from', SOURCE_DIR)
    papers, coverage = load_papers()
    roster = load_roster()
    wl_year, rankings, rankings_fetched = load_rankings()
    us, us_meta, usnews_table = load_us_schools(roster['school'].unique())
    aba, aba_check = load_aba(roster['school'].unique())
    extra = sorted(set(aba) - set(us))
    if extra:
        print(f'  {len(extra)} ABA-approved schools not matched to US News, counted as US law schools too:', extra)
    print(f"  US law schools: {len(set(us) | set(aba))} ({us_meta['schools']} from {us_meta['source']}, "
          f"{len(aba)} from the ABA list)")

    ##### journals and their categories
    ranked = rankings[rankings['journal'].isin(papers['journal'].unique())]
    subjects = sorted(s for s in ranked['journal_type'].unique() if s != 'General')
    subject_to_group = {s: g for g, subs in SUBJECT_GROUPS.items() for s in subs}
    unmapped = [s for s in subjects if s not in subject_to_group]
    groups = list(SUBJECT_GROUPS) + (['Other'] if unmapped else [])
    for s in unmapped:
        print('  !! W&L subject not in SUBJECT_GROUPS, putting it in Other:', s)
        subject_to_group[s] = 'Other'

    # rank within each group by W&L score (journals in several subjects of a group count once)
    group_rank = {}
    spec = ranked[ranked['journal_type'] != 'General'].copy()
    spec['group'] = spec['journal_type'].map(subject_to_group)
    for g, gdf in spec.groupby('group'):
        best = gdf.groupby('journal')['score'].max().sort_values(ascending=False)
        for pos, (j, score) in enumerate(best.items(), start=1):
            group_rank[(j, g)] = pos if pd.notna(score) else None

    journal_names = sorted(ranked['journal'].unique())
    journal_id = {j: i for i, j in enumerate(journal_names)}
    collected_on = dict(zip(coverage['journal'], coverage['collected']))
    journals = []
    flagship = load_flagship(sorted(ranked.loc[ranked['journal_type'] == 'General', 'journal'].unique()), usnews_table)
    for j in journal_names:
        jdf = ranked[ranked['journal'] == j]
        # flagship: the school's US News rank (0 = unranked school, -1 = online edition or other general
        # journal, None = not a General journal); the W&L General rank is not used
        general_rank, host = flagship.get(j, [None, None])
        # [subject id, W&L rank in that subject (0 = NR), W&L score] - the site re-ranks groups from the scores
        subs = [[subjects.index(r.journal_type), int(r.WandL_rank) if pd.notna(r.score) else 0,
                 float(r.score) if pd.notna(r.score) else None]
                for r in jdf.itertuples() if r.journal_type != 'General']
        grps = sorted({(groups.index(subject_to_group[subjects[s]]),
                        group_rank.get((j, subject_to_group[subjects[s]])) or 0) for s, _, _ in subs})
        # rank 0 = listed by W&L but not ranked (NR); it only shows up under "All"
        journals.append([j, collected_on[j], general_rank, subs, [list(g) for g in grps]] + ([host] if host else []))

    not_ranked = sorted(set(papers['journal']) - set(journal_names))
    if not_ranked:
        print(f'  {len(not_ranked)} collected journals are not on W&L {wl_year} (renamed or dropped), skipping:', not_ranked)
    papers = papers[papers['journal'].isin(journal_id)]

    ##### authorship credit
    papers['paper_key'] = papers['journal'] + '|' + papers['volume_key'] + '|' + papers['title_key']
    # Hein sometimes lists the same papers under two volume numbers of the same year (Urban Lawyer 42 and 43,
    # "Volume 58 (Supplement)" also inside vol 58): same journal, year, title and authors count once
    authors_of = papers.groupby('paper_key')['author_key'].agg(lambda a: '|'.join(sorted(set(a))))
    year_of = papers.groupby('paper_key')['year'].first()
    sig = {k: (k.split('|', 1)[0], year_of[k], k.rsplit('|', 1)[1], authors_of[k]) for k in authors_of.index}
    first = {}
    for k in sorted(sig):
        first.setdefault(sig[k], k)
    same = {k: first[sig[k]] for k in sig if first[sig[k]] != k}
    if same:
        print(f'  {len(same)} papers listed twice by Hein in the same year (two volume numbers); counted once')
        papers['paper_key'] = papers['paper_key'].map(lambda k: same.get(k, k))
    n_authors = papers.groupby('paper_key')['author_key'].nunique()
    matched, stats = match_authors(papers, roster)
    print('  author matching:', stats)

    credited = papers[papers['author'].isin(matched)].copy()
    first_rows = credited.drop_duplicates('paper_key').set_index('paper_key')
    # sorted by year so the titles can be split into per-decade files the site loads on demand
    paper_keys = sorted(first_rows.index, key=lambda k: (first_rows.at[k, 'year'], k))
    paper_id = {k: i for i, k in enumerate(paper_keys)}

    schools = sorted(roster['school'].unique())
    school_id = {s: i for i, s in enumerate(schools)}
    person_rows = sorted({i for idx in matched.values() for i in idx})
    # one person per distinct name, credited at every school that lists them
    person_key = lambda i: (roster.at[i, 'last'], roster.at[i, 'first'], roster.at[i, 'middle'])
    people_keys = sorted({person_key(i) for i in person_rows})
    person_id = {k: n for n, k in enumerate(people_keys)}
    # [display name, school ids, Hein search_name for their AuthorProfile link]
    people = [[None, [], None] for _ in people_keys]
    for i in person_rows:
        p = people[person_id[person_key(i)]]
        p[0] = display_name(roster.at[i, 'author'])
        p[2] = roster.at[i, 'hein_name']
        sid = school_id[roster.at[i, 'school']]
        if sid not in p[1]:
            p[1].append(sid)

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

    p = first_rows.loc[paper_keys]
    data = {
        'schools': [[s, s in us or s in aba, us.get(s, (None, None))[1]] for s in schools],
        'people': people,
        'subjects': subjects,
        'groups': groups,
        'journals': journals,
        'papers': {
            'journal': [journal_id[j] for j in p['journal']],
            'year': [int(y) for y in p['year']],
            'authors': [int(n_authors[k]) for k in paper_keys],
            'minor': [1 if MINOR_TITLE.search(t) else 0 for t in p['title']],
        },
        'credits': {'paper': credit_paper, 'person': credit_person},
    }

    # titles/<decade>.json as [title, Hein link] (link '' for papers from the old collections), before 1970 in titles/early.json
    title_chunks = defaultdict(list)
    for t, y, link in zip(p['title'], p['year'], p['article_link']):
        title_chunks['early' if y < 1970 else str(y // 10 * 10)].append([str(t), str(link or '')])
    data['title_chunks'] = []
    start = 0
    for name, chunk in title_chunks.items():
        data['title_chunks'].append([name, start, start + len(chunk)])
        start += len(chunk)

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
                   'minor_papers': int(sum(1 for m in data['papers']['minor'] if m))},
        'matching': stats,
        'group_subjects': {g: [s for s in subjects if subject_to_group[s] == g] for g in groups},
        'coverage': [{k: (None if isinstance(v, float) and v != v else v) for k, v in r.items()}
                     for r in used.sort_values('journal').to_dict(orient='records')],
    }

    # the build number goes up whenever the data the site shows changes
    digest = hashlib.sha1(json.dumps([data, title_chunks], sort_keys=True).encode()).hexdigest()[:12]
    prev = {}
    if os.path.exists(os.path.join(OUT_DIR, 'meta.json')):
        prev = json.load(open(os.path.join(OUT_DIR, 'meta.json'), encoding='utf-8'))
    meta['version'] = VERSION
    meta['build'] = prev.get('build', 0) + (0 if prev.get('digest') == digest else 1)
    meta['digest'] = digest
    history = update_history(meta, data, prev)

    os.makedirs(os.path.join(OUT_DIR, 'titles'), exist_ok=True)
    for f in glob.glob(os.path.join(OUT_DIR, 'titles', '*.json')):
        os.remove(f)
    outputs = [('data.json', data), ('meta.json', meta), ('history.json', history)]
    outputs += [(f'titles/{name}.json', chunk) for name, chunk in title_chunks.items()]
    for name, obj in outputs:
        with open(os.path.join(OUT_DIR, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        print(f'  wrote docs/data/{name} ({os.path.getsize(os.path.join(OUT_DIR, name)) / 1e6:.1f} MB)')
    print('  papers', meta['counts']['papers'], '| credits', meta['counts']['credits'],
          '| faculty with papers', meta['counts']['faculty_with_papers'],
          '| papers collected', meta['papers_collected']['from'], 'to', meta['papers_collected']['to'])
    return meta


def publish(meta):
    e = meta.get('history_entry', {})
    ch = e.get('changes', {})
    msg = (f"Build {meta['build']}: data update {meta['built']}\n\n"
           f"papers collected {meta['papers_collected']['from']} to {meta['papers_collected']['to']}; "
           f"faculty lists {meta['faculty_collected']['from']} to {meta['faculty_collected']['to']}; "
           f"W&L {meta['rankings']['edition']}\n"
           f"papers {meta['counts']['papers']} ({ch.get('papers', 0):+d}), "
           f"faculty with papers {meta['counts']['faculty_with_papers']} ({ch.get('faculty_with_papers', 0):+d}), "
           f"{len(ch.get('moved', []))} of the default top 30 moved")
    # only docs/ is committed (other staged or changed files in the repo stay as they are); git never waits
    # for a password prompt; a push that failed last time is retried even when there is nothing new
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    git = lambda *a, **k: subprocess.run(['git', *a], cwd=HERE, env=env, **k)
    git('add', 'docs', check=True)   # the data and the page code that reads it
    if git('diff', '--cached', '--quiet', '--', 'docs').returncode != 0:
        git('commit', '-m', msg, '--', 'docs', check=True)
    else:
        print('no data changes to publish')
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
