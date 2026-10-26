# Law School Rankings

Law schools ranked by where their current faculty publish, in the style of CSrankings: articles in the journals you
choose, credited to each author's current school and split between co-authors. Article and faculty metadata come
from HeinOnline; journal ranks from Washington & Lee (specialty journals) and U.S. News (flagship law reviews, which
take their school's rank).

Live at **https://nathanreitinger.github.io/lawRankings/** (GitHub Pages, branch `main`, folder `/docs`). The site is
static; rankings are computed in the browser from `docs/data/`. The old address, lawschoolrankings.pythonanywhere.com,
redirects here once `pythonanywhere_wsgi.py` is installed as its WSGI file (PythonAnywhere: Web tab, the WSGI
configuration file, replace its contents, Save, Reload).

## Pages

| page | what |
|---|---|
| `index.html` | the rankings (CSrankings style): flagship law reviews by their school's rank, specialty journals by W&L rank and subject area; each faculty member's bars, their areas (the areas of the specialty journals they published in; nothing inferred) and faculty page |
| `insights.html` | who publishes where (a network from schools to flagship reviews; one journal's institutions and authors with drill-down; a table; rank against rank) and co-authorship over time |
| `taxonomy.html` | the subject areas of the specialty journals: area > field > journal, with papers by current faculty in each; how it was built; the sources |
| `faq.html` | about and method |
| `history.html` | every version and what changed |

The masthead is one of thirty wordmarks (`style.css`, `[data-mast]`), a new one on each visit. Explanatory text is
set in YaleNew (`docs/fonts/`).

## How the data is built

`build_data.py` turns the collected metadata, kept in a data folder outside this repository, into `docs/data/`:

```bash
python build_data.py              # rebuild docs/data/*.json
python build_data.py --publish    # rebuild, then commit and push docs/ and faculty/ (the site updates)
```

| input (data folder) | used for |
|---|---|
| journal tables of contents (`journal_store/`) | articles, their authors, volumes, years and page numbers |
| faculty lists by school (`faculty_runs/`) | who teaches where; articles are credited to the author's *current* school |
| HeinOnline author profiles (`hein_profiles/`) | no longer collected or used: every faculty member is matched by name |
| per-school faculty metadata (`faculty_runs/school_csv/`) | links to each faculty member's bio page |
| newest `rankings_<year>.csv` | Washington & Lee specialty-journal ranks and subjects; which journals are general (flagship) |
| newest `usnews_<edition>.csv` | which schools count as US law schools; flagship ranks |
| newest `aba_schools_<year>.csv` | a check that every ABA-approved law school is on the faculty lists |
| `flagship_schools.csv` | which school publishes each general journal, and whether it is that school's main law review |
| `journal_taxonomy_scope.csv`, `wl_subject_taxonomy.csv` | each specialty journal's subject area and field, placed by its own scope statement and W&L subject (with the deciding words); the W&L subject for journals not placed yet |
| `specialty_hosts.csv` | the school (or society or press) that publishes each specialty journal |
| `faculty_runs/inferred_homepages.csv` | faculty pages found on the schools' own websites where the school lists lack one |
| `short_pieces/model_short.csv` | the short-piece model's predictions (trained in the data folder's `models/`) |

## How articles are matched to faculty

One faculty member is one person on HeinOnline's faculty lists (keyed by their HeinOnline author name). Name rules
decide which articles are theirs: the exact name first, then first and last name when that is one person and the middle initials agree, then
the same ignoring a "Jr." or "III" one side leaves off; ambiguous names are not credited. Corrections anyone can
propose are in `faculty/edits.csv` (see `faculty/README.md`).

## Versions

`major.data.site`, shown as "Volume 2.1.0" in the masthead: the build hashes the substantive data and the site's own
files; a data change bumps the middle number and sets the "data updated" Unix timestamp; a site-only change bumps
the last number (`python build_data.py --site-version` does just that, without rebuilding the data); `MAJOR` in `build_data.py` is set by hand. Every data change gets an entry in
`docs/data/history.json`, shown on `history.html`.

## Short pieces

"Skip short pieces" leaves out pieces under 10 pages (or memorials under 20). Lengths come from page numbers in the
article metadata; where a length is not known yet, a classifier trained on the measured pieces decides.

The old Flask app (`r.py`, `templates/`, `author/auth.csv`) is untouched and no longer used by the static site.
