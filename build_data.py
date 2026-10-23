'''
build the data files for the static site (docs/) from whatever the scrapers in ../../main.py left behind

1. papers per journal      journal_store/ (get_papers; see journal_store.py, the repaired incremental store)
2. faculty per school      faculty_runs/ (get_authors_from_v3, Hein AuthorBySchool), older authors_latest.csv
3. journal ranks           newest rankings_<year>.csv (update_WandL, Washington & Lee)
4. US law school list      newest usnews_<edition>.csv (update_usnews), else the hand-saved 2025_USnews.txt

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
from collections import defaultdict
from datetime import datetime
from urllib.parse import urlparse, parse_qs, unquote

import sys

import pandas as pd
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPE_DIR = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(HERE, 'docs', 'data')

sys.path.insert(0, SCRAPE_DIR)
import journal_store as js   # noqa: E402  (shared volume keys, years and author keys with the scraper)

VERSION = 2   # shown on the site as "Volume 2"; each data change bumps the build number

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

# short pieces we will probably want to weed out later; flagged (not dropped) so the site can toggle them
MINOR_TITLE = re.compile(
    r'\b(foreword|afterword|preface|prologue|epilogue|in memoriam|tribute|dedication|eulogy|remembering'
    r'|book reviews?|remarks|keynote|panel|transcript|roundtable|response|reply|rejoinder|errat(um|a))\b'
    r'|^(an? )?introduction\b',
    re.IGNORECASE,
)

NAME_SUFFIXES = {'jr', 'sr', 'ii', 'iii', 'iv', 'v'}

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
    clean = lambda s: re.sub(r'[^a-z0-9\- ]', ' ', s.lower()).split()
    last = ' '.join(clean(last))
    parts = [p for p in clean(rest) if p not in NAME_SUFFIXES]
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
    '''every journal in scrape/journal_store/, plus when each was last checked'''
    rows, coverage = [], []
    for f in sorted(glob.glob(os.path.join(SCRAPE_DIR, js.STORE_DIR, 'j___*.csv'))):
        journal = os.path.basename(f)[len('j___'):-len('.csv')]
        df = pd.read_csv(f, dtype=str, keep_default_na=False)
        with open(f[:-len('.csv')] + '.json', encoding='utf-8') as fh:
            state = json.load(fh)
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
        newest_volume = max((v.get('scraped_at') or '' for v in vols.values()), default='')
        scraped = (state.get('checked_at') or newest_volume)[:10]
        coverage.append({
            'journal': journal,
            'scraped': scraped,
            'latest_year': None if df['year'].isna().all() else int(df['year'].max()),
            'papers': int(df.groupby(['volume_key', 'title_key']).ngroups),
            'checked_by_new_scraper': bool(state.get('verified_at')),
            'volumes_to_recheck': sum(1 for v in vols.values() if v.get('status') == 'suspect'),
        })
    papers = pd.concat(rows, ignore_index=True)
    papers = papers[papers['year'].notna()]
    papers['year'] = papers['year'].astype(int)
    return papers, pd.DataFrame(coverage)


def load_roster():
    '''newest faculty list for each school, from get_authors_from_v3 runs (faculty_runs/) and the older authors_latest.csv'''
    sources = []   # oldest first
    old = os.path.join(SCRAPE_DIR, 'authors_latest.csv')
    if os.path.exists(old):
        sources.append(('authors_latest', pd.read_csv(old).rename(columns={'name': 'author'}), True))
    for f in sorted(glob.glob(os.path.join(SCRAPE_DIR, 'faculty_runs', 'authors_*.csv'))):
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

    parsed = df['link'].map(parse_hein_name)
    df['last'] = parsed.map(lambda p: p[0])
    df['first'] = parsed.map(lambda p: p[1])
    df['middle'] = parsed.map(lambda p: p[2])
    df['hein_name'] = df['link'].map(lambda u: unquote(parse_qs(urlparse(str(u)).query).get('search_name', [''])[0]).strip())
    stamped = pd.to_datetime(df['scraped_at'], errors='coerce') if 'scraped_at' in df.columns else pd.Series(pd.NaT, index=df.index)
    from_link = pd.to_datetime(df['link'].str.extract(r'1==(\d{10})')[0].astype(float), unit='s')
    df['scraped'] = stamped.fillna(from_link)
    print('  faculty lists:', ', '.join(f'{r} ({n} people)' for r, n in df['run'].value_counts().sort_index().items()))
    return df


def load_rankings():
    found = {}
    for f in glob.glob(os.path.join(SCRAPE_DIR, 'rankings_*.csv')):
        m = re.fullmatch(r'rankings_(\d{4})\.csv', os.path.basename(f))
        if m:
            found[int(m.group(1))] = f
    year = max(found)
    df = pd.read_csv(found[year])
    df['score'] = pd.to_numeric(df['score'], errors='coerce')   # "NR" -> NaN
    df['WandL_rank'] = pd.to_numeric(df['WandL_rank'], errors='coerce')
    return year, df, datetime.fromtimestamp(os.path.getmtime(found[year]))


def load_usnews():
    '''(edition, source, {US News name: rank label}) from the newest usnews_<edition>.csv in scrape/.
    Written by update_usnews() (TaxProf Blog) or usnews_manual.py (a US News page saved by hand); within an
    edition the hand-saved page wins. TaxProf lists ranked schools only, so "Unranked" schools are carried over
    from the newest hand-saved page. Names TaxProf uses that aren't in taxprof_aliases.csv are skipped.'''
    by_edition, manual = defaultdict(dict), {}
    for f in glob.glob(os.path.join(SCRAPE_DIR, 'usnews_*.csv')):
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
        soup = BeautifulSoup(open(os.path.join(SCRAPE_DIR, '2025_USnews.txt'), encoding='utf-8').read(), 'html.parser')
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
    return to_ret, {'edition': edition, 'source': source, 'schools': len(to_ret)}


################################################ build

def match_authors(papers, roster):
    '''paper author link -> list of roster row indexes (a person listed at two schools gets both)'''
    full = defaultdict(list)
    short = defaultdict(list)
    for i, r in roster.iterrows():
        full[(r['last'], r['first'], r['middle'])].append(i)
        short[(r['last'], r['first'])].append(i)

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
        if len(people) == 1:
            to_ret[link] = cands
            stats['first_last'] += 1
        elif len(people) > 1:
            stats['ambiguous'] += 1
        else:
            stats['not_faculty'] += 1
    return to_ret, dict(stats)


def default_ranking(data, years=10, top=30):
    '''the site's default view in Python: General top 10, last `years` years, US law schools'''
    last = max(data['papers']['year'])
    journals = {i for i, j in enumerate(data['journals']) if j[2] and 1 <= j[2] <= 10}
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
        'papers_scraped': meta['papers_scraped'], 'faculty_scraped': meta['faculty_scraped'],
        'rankings_edition': meta['rankings']['edition'], 'us_schools': meta.get('us_schools'),
        'counts': meta['counts'], 'top': default_ranking(data),
    }
    if history and history[-1]['build'] == meta['build']:
        history[-1] = entry        # same data as the last build: refresh its entry, keep the number
    else:
        if history:
            before = history[-1]
            old_rank = {s: i for i, (s, _, _) in enumerate(before['top'], start=1)}
            entry['changes'] = {
                'papers': meta['counts']['papers'] - before['counts']['papers'],
                'faculty_with_papers': meta['counts']['faculty_with_papers'] - before['counts']['faculty_with_papers'],
                'moved': [[s, old_rank.get(s), i] for i, (s, _, _) in enumerate(entry['top'], start=1) if old_rank.get(s) != i],
            }
        history.append(entry)
    meta['history_entry'] = entry
    return history


def build():
    print('reading scrapes from', SCRAPE_DIR)
    papers, coverage = load_papers()
    roster = load_roster()
    wl_year, rankings, rankings_fetched = load_rankings()
    us, us_meta = load_us_schools(roster['school'].unique())
    print(f"  US law schools: {us_meta['schools']} from {us_meta['source']}")

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
    scraped_on = dict(zip(coverage['journal'], coverage['scraped']))
    journals = []
    for j in journal_names:
        jdf = ranked[ranked['journal'] == j]
        gen = jdf[jdf['journal_type'] == 'General']
        general_rank = None
        if len(gen):
            general_rank = int(gen['WandL_rank'].iloc[0]) if pd.notna(gen['score'].iloc[0]) else 0
        # [subject id, W&L rank in that subject (0 = NR), W&L score] - the site re-ranks groups from the scores
        subs = [[subjects.index(r.journal_type), int(r.WandL_rank) if pd.notna(r.score) else 0,
                 float(r.score) if pd.notna(r.score) else None]
                for r in jdf.itertuples() if r.journal_type != 'General']
        grps = sorted({(groups.index(subject_to_group[subjects[s]]),
                        group_rank.get((j, subject_to_group[subjects[s]])) or 0) for s, _, _ in subs})
        # rank 0 = listed by W&L but not ranked (NR); it only shows up under "All"
        journals.append([j, scraped_on[j], general_rank, subs, [list(g) for g in grps]])

    not_ranked = sorted(set(papers['journal']) - set(journal_names))
    if not_ranked:
        print(f'  {len(not_ranked)} scraped journals are not on W&L {wl_year} (renamed or dropped), skipping:', not_ranked)
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
        'schools': [[s, s in us, us.get(s, (None, None))[1]] for s in schools],
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

    # titles/<decade>.json as [title, Hein link] (link '' for papers from the old scrapes), before 1970 in titles/early.json
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
    roster_times = roster['scraped'].dropna()
    meta = {
        'built': datetime.now().strftime('%Y-%m-%d'),
        'papers_scraped': {'from': used['scraped'].min(), 'to': used['scraped'].max(), 'journals': int(len(used))},
        'faculty_scraped': {
            'from': roster_times.min().strftime('%Y-%m-%d') if len(roster_times) else None,
            'to': roster_times.max().strftime('%Y-%m-%d') if len(roster_times) else None,
            'faculty': int(len(roster)),
            'schools': int(roster['school'].nunique()),
        },
        'us_schools': us_meta,
        'rankings': {'source': 'Washington & Lee Law Journal Rankings', 'edition': wl_year,
                     'fetched': rankings_fetched.strftime('%Y-%m-%d')},
        'years': {'min': int(min(data['papers']['year'])), 'max': int(max(data['papers']['year']))},
        'counts': {'papers': len(paper_keys), 'credits': len(credit_paper), 'faculty_with_papers': len(people),
                   'minor_papers': int(sum(data['papers']['minor']))},
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
          '| papers scraped', meta['papers_scraped']['from'], 'to', meta['papers_scraped']['to'])
    return meta


def publish(meta):
    e = meta.get('history_entry', {})
    ch = e.get('changes', {})
    msg = (f"Build {meta['build']}: data update {meta['built']}\n\n"
           f"papers scraped {meta['papers_scraped']['from']} to {meta['papers_scraped']['to']}; "
           f"faculty lists {meta['faculty_scraped']['from']} to {meta['faculty_scraped']['to']}; "
           f"W&L {meta['rankings']['edition']}\n"
           f"papers {meta['counts']['papers']} ({ch.get('papers', 0):+d}), "
           f"faculty with papers {meta['counts']['faculty_with_papers']} ({ch.get('faculty_with_papers', 0):+d}), "
           f"{len(ch.get('moved', []))} of the default top 30 moved")
    subprocess.run(['git', 'add', 'docs'], cwd=HERE, check=True)   # the data and the page code that reads it
    if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=HERE).returncode == 0:
        print('no data changes to publish')
        return
    subprocess.run(['git', 'commit', '-m', msg], cwd=HERE, check=True)
    subprocess.run(['git', 'push'], cwd=HERE, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='build docs/data for the static rankings site')
    parser.add_argument('--publish', action='store_true', help='git commit + push docs/ after building')
    args = parser.parse_args()
    meta = build()
    if args.publish:
        publish(meta)
