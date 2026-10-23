# Law School Rankings

Law schools ranked by where their current faculty publish (CSrankings-style), using HeinOnline metadata and the Washington & Lee law journal rankings.

The site is static: `docs/` is served as-is (GitHub Pages → Settings → Pages → Deploy from branch `main`, folder `/docs`). Rankings are computed in the browser from `docs/data/`.

## Updating the data

The scrapers live in `scrape/main.py` (two folders up, not in this repo). Run from `scrape/`:

```bash
python main.py -g yes                                   # scrape journals + faculty lists, then rebuilds docs/data
python LAWrankings/lawSchoolRankings/build_data.py      # or: rebuild docs/data from whatever is already scraped
python LAWrankings/lawSchoolRankings/build_data.py --publish   # rebuild, then git commit + push docs/data
```

`build_data.py` reads:

| input | from | used for |
|---|---|---|
| `j___<journal>.csv`, `last_one___<date>/j___*.csv` | `get_papers()` | papers; every snapshot is merged, newest wins, so a half-finished scrape never loses older data |
| `authors_latest.csv` | `get_authors_from_v3()` (Hein AuthorBySchool) | who teaches where; papers are credited to the author's *current* school |
| newest `rankings_<year>.csv` | `update_WandL()` | General ranks and W&L subjects |
| `2025_USnews.txt` | saved by hand | which schools count as US law schools |

The "data as of" line on the site and the FAQ's per-journal table come from `docs/data/meta.json`, which records when each journal and the faculty lists were scraped (`scraped_at` column going forward, file dates for older scrapes).

## Things the build fixes or flags

- Cross-volume duplicates: when an issue fails to collapse during scraping, its papers get re-read under every older volume. Only the first (real) volume is kept.
- Author matching: exact Hein name first, then first + last name when that is one person and middle initials don't conflict. Ambiguous names are skipped (counts are printed).
- Short pieces (forewords, tributes, book reviews, responses, ...) are flagged by title in `papers.minor`; the site can hide them. Page counts are not scraped yet, which would be a better test.
- Specialty groups: edit `SUBJECT_GROUPS` in `build_data.py`. New W&L subjects that aren't listed go to "Other" and are printed.

The old Flask app (`r.py`, `templates/`, `author/auth.csv`) is untouched and no longer needed by the static site.
