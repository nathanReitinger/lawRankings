'''
build the data files for the static site (docs/) from whatever the update scripts in ../../main.py left behind

1. papers per journal      j___<journal>.csv in the data folder (newest) and last_one___<date>/ (older runs)
2. faculty per school      authors_latest.csv (get_authors_from_v3, Hein AuthorBySchool)
3. journal ranks           rankings_<year>.csv (update_WandL, Washington & Lee)
4. US law school list      2025_USnews.txt (hand-saved US News page)

python build_data.py              # rebuild docs/data/*.json
python build_data.py --publish    # rebuild, then git commit + push docs/data (site updates on GitHub Pages)
'''

import argparse
import glob
import json
import os
import re
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs, unquote

import pandas as pd
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(HERE, 'docs', 'data')

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
    '''latest year mentioned in a Hein volume label, e.g. "31   (2023-2024)" -> 2024, "29 (1999-00)" -> 2000'''
    v = str(volume)
    if 'Index to Vols.' in v:
        return None
    years = [int(y) for y in re.findall(r'(?<!\d)(1[6-9]\d\d|20\d\d)(?!\d)', v)]
    for start, end in re.findall(r'(?<!\d)(1[6-9]\d\d|20\d\d)-(\d\d)(?!\d)', v):
        start = int(start)
        end = start - start % 100 + int(end)
        years.append(end if end >= start else end + 100)
    years = [y for y in years if y <= datetime.now().year + 1]
    return max(years) if years else None


def load_journal_snapshots():
    '''every j___*.csv we have, newest collection first for each journal'''
    files = glob.glob(os.path.join(SOURCE_DIR, 'j___*.csv'))
    files += glob.glob(os.path.join(SOURCE_DIR, 'last_one___*', 'j___*.csv'))
    snaps = defaultdict(list)
    for f in files:
        df = pd.read_csv(f)
        if df.empty:
            continue
        journal = os.path.basename(f)[len('j___'):-len('.csv')]
        if 'collected_at' in df.columns and df['collected_at'].notna().any():
            collected = pd.to_datetime(df['collected_at']).max().to_pydatetime()
        else:
            collected = datetime.fromtimestamp(os.path.getmtime(f))
        snaps[journal].append((collected, df))
    for journal in snaps:
        snaps[journal].sort(key=lambda x: x[0], reverse=True)
    return snaps


def clean_snapshot(df):
    df = df.dropna(subset=['title', 'author']).copy()
    df['title'] = df['title'].astype(str).str.replace(r'\s+', ' ', regex=True).str.strip()
    df['title_key'] = df['title'].str.lower().str.replace(r'[^a-z0-9]', '', regex=True)
    df = df[df['title_key'] != '']
    # when an issue fails to collapse, get_papers re-reads its papers under every older volume;
    # the first time a (title, author) shows up is the real volume
    return df.drop_duplicates(subset=['title_key', 'author'], keep='first')


def load_papers():
    rows = []
    coverage = []
    for journal, snaps in load_journal_snapshots().items():
        cleaned = [clean_snapshot(df).assign(_snap=i) for i, (_, df) in enumerate(snaps)]
        merged = pd.concat(cleaned).drop_duplicates(subset=['title_key', 'author'], keep='first')
        merged['journal'] = journal
        merged['year'] = merged['volume'].map(infer_year)
        rows.append(merged)
        coverage.append({
            'journal': journal,
            'collected': snaps[0][0].strftime('%Y-%m-%d'),
            'latest_year': None if merged['year'].isna().all() else int(merged['year'].max()),
            'papers': int(merged.groupby(['volume', 'title_key']).ngroups),
        })
    papers = pd.concat(rows, ignore_index=True)
    papers = papers[papers['year'].notna()]
    papers['year'] = papers['year'].astype(int)
    return papers, pd.DataFrame(coverage)


def load_roster():
    df = pd.read_csv(os.path.join(SOURCE_DIR, 'authors_latest.csv'))
    parsed = df['link'].map(parse_hein_name)
    df['last'] = parsed.map(lambda p: p[0])
    df['first'] = parsed.map(lambda p: p[1])
    df['middle'] = parsed.map(lambda p: p[2])
    df['collected'] = df['link'].str.extract(r'1==(\d{10})')[0].astype(float)
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


def load_us_schools(roster_schools):
    '''roster school name -> (US News name, US News rank) for US law schools'''
    def norm(s):
        s = s.lower().replace('&', 'and')
        s = re.sub(r'\(.*?\)', '', s)
        s = s.replace('--', ' ').replace('-', ' ')
        s = re.sub(r'\b(the|school of law|law school|law center|college of law|at|in)\b', ' ', s)
        s = re.sub(r'[^a-z0-9 ]', '', s)
        return re.sub(r'\s+', ' ', s).strip()

    html = open(os.path.join(SOURCE_DIR, '2025_USnews.txt'), encoding='utf-8').read()
    soup = BeautifulSoup(html, 'html.parser')
    by_norm = defaultdict(list)
    for s in roster_schools:
        by_norm[norm(s)].append(s)

    to_ret = {}
    for div in soup.find_all('div', attrs={'name': True}):
        us_name = div.get('name').strip()
        rank_tag = div.find('strong', string=lambda s: s and '#' in s)
        rank = rank_tag.get_text(strip=True).replace('#', '') if rank_tag else None
        n = norm(USNEWS_TO_HEIN.get(us_name, us_name))
        hits = by_norm.get(n)
        if not hits:
            # "University of Michigan--Ann Arbor" vs "University of Michigan"
            prefixes = [k for k in by_norm if n.startswith(k + ' ')]
            hits = by_norm[prefixes[0]] if len(prefixes) == 1 else []
        for h in hits:
            to_ret.setdefault(h, (us_name, rank))
    return to_ret


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


def build():
    print('reading collections from', SOURCE_DIR)
    papers, coverage = load_papers()
    roster = load_roster()
    wl_year, rankings, rankings_fetched = load_rankings()
    us = load_us_schools(roster['school'].unique())

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
    for j in journal_names:
        jdf = ranked[ranked['journal'] == j]
        gen = jdf[jdf['journal_type'] == 'General']
        general_rank = None
        if len(gen):
            general_rank = int(gen['WandL_rank'].iloc[0]) if pd.notna(gen['score'].iloc[0]) else 0
        subs = [[subjects.index(r.journal_type), int(r.WandL_rank) if pd.notna(r.score) else 0]
                for r in jdf.itertuples() if r.journal_type != 'General']
        grps = sorted({(groups.index(subject_to_group[subjects[s]]),
                        group_rank.get((j, subject_to_group[subjects[s]])) or 0) for s, _ in subs})
        # rank 0 = listed by W&L but not ranked (NR); it only shows up under "All"
        journals.append([j, collected_on[j], general_rank, subs, [list(g) for g in grps]])

    not_ranked = sorted(set(papers['journal']) - set(journal_names))
    if not_ranked:
        print(f'  {len(not_ranked)} collected journals are not on W&L {wl_year} (renamed or dropped), skipping:', not_ranked)
    papers = papers[papers['journal'].isin(journal_id)]

    ##### authorship credit
    papers['paper_key'] = papers['journal'] + '|' + papers['volume'].astype(str) + '|' + papers['title_key']
    n_authors = papers.groupby('paper_key')['author'].nunique()
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
    people = [[None, []] for _ in people_keys]
    for i in person_rows:
        p = people[person_id[person_key(i)]]
        p[0] = display_name(roster.at[i, 'name'])
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

    # titles/<decade>.json, everything before 1970 in titles/early.json
    title_chunks = defaultdict(list)
    for t, y in zip(p['title'], p['year']):
        title_chunks['early' if y < 1970 else str(y // 10 * 10)].append(str(t))
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
            'from': datetime.fromtimestamp(roster_times.min(), tz=timezone.utc).strftime('%Y-%m-%d') if len(roster_times) else None,
            'to': datetime.fromtimestamp(roster_times.max(), tz=timezone.utc).strftime('%Y-%m-%d') if len(roster_times) else None,
            'faculty': int(len(roster)),
            'schools': int(roster['school'].nunique()),
        },
        'rankings': {'source': 'Washington & Lee Law Journal Rankings', 'edition': wl_year,
                     'fetched': rankings_fetched.strftime('%Y-%m-%d')},
        'years': {'min': int(min(data['papers']['year'])), 'max': int(max(data['papers']['year']))},
        'counts': {'papers': len(paper_keys), 'credits': len(credit_paper), 'faculty_with_papers': len(people),
                   'minor_papers': int(sum(data['papers']['minor']))},
        'matching': stats,
        'group_subjects': {g: [s for s in subjects if subject_to_group[s] == g] for g in groups},
        'coverage': used.sort_values('journal').to_dict(orient='records'),
    }

    os.makedirs(os.path.join(OUT_DIR, 'titles'), exist_ok=True)
    for f in glob.glob(os.path.join(OUT_DIR, 'titles', '*.json')):
        os.remove(f)
    outputs = [('data.json', data), ('meta.json', meta)]
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
    msg = f"Data update {meta['built']} (papers collected through {meta['papers_collected']['to']})"
    subprocess.run(['git', 'add', 'docs/data'], cwd=HERE, check=True)
    if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=HERE).returncode == 0:
        print('no data changes to publish')
        return
    subprocess.run(['git', 'commit', '-m', msg], cwd=HERE, check=True)
    subprocess.run(['git', 'push'], cwd=HERE, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='build docs/data for the static rankings site')
    parser.add_argument('--publish', action='store_true', help='git commit + push docs/data after building')
    args = parser.parse_args()
    meta = build()
    if args.publish:
        publish(meta)
