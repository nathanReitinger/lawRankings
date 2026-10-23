# Law School Rankings

Law schools ranked by where their current faculty publish (CSrankings-style), using HeinOnline metadata and the Washington & Lee law journal rankings.

Live at **https://nathanreitinger.github.io/lawRankings/** (GitHub Pages, branch `main`, folder `/docs`). The site is static; rankings are computed in the browser from `docs/data/`.
The old address, lawschoolrankings.pythonanywhere.com, redirects there (`pythonanywhere_wsgi.py`).

## Updating the data

The update scripts live in `main.py` (two folders up, not in this repo; see `PATCHES.md`). From the data folder:

```bash
python main.py --check      # dry run against HeinOnline (log in when Chrome opens), saves pages to check_output/
python main.py --no-push    # update everything and rebuild docs/data, without publishing
python main.py              # update everything, rebuild docs/data, commit + push (the site updates)
```

One run: W&L ranks -> US News list (via TaxProf Blog) -> Hein links for newly ranked journals -> journals
(incremental, into `journal_store/`) -> faculty lists (refreshed every 120 days) -> `build_data.py --publish`.
If it stops, run it again; it picks up where it left off.

`build_data.py` reads:

| input | from | used for |
|---|---|---|
| `journal_store/` | `get_papers()` + `journal_store.py` | papers; one repaired, incremental store per journal |
| `faculty_runs/authors_<date>.csv` (older: `authors_latest.csv`) | `get_authors_from_v3()` (Hein AuthorBySchool) | who teaches where; papers are credited to the author's *current* school |
| newest `rankings_<year>.csv` | `update_WandL()` | General ranks and W&L subjects |
| newest `usnews_<edition>.csv` / `usnews_<edition>_manual.csv` | `update_usnews()` / `usnews_manual.py` | which schools count as US law schools |

Every build that changes the data gets the next build number (shown as "Volume 2 · Build n" in the masthead)
and an entry in `docs/data/history.json`, shown on `history.html`.

## Things the build fixes or flags

- Older-collection damage (leaked and mislabeled volumes) is repaired in `journal_store/`; see `PATCHES.md`.
- Hein listing the same papers under two volume numbers in one year: counted once.
- Author matching: exact Hein name first, then first + last name when that is one person and middle initials don't conflict. Ambiguous names are skipped (counts are printed).
- Short pieces (forewords, tributes, book reviews, responses, ...) are flagged by title in `papers.minor`; the site can hide them. Page counts are not collected yet, which would be a better test.
- Specialty groups: edit `SUBJECT_GROUPS` in `build_data.py`. New W&L subjects that aren't listed go to "Other" and are printed.

The old Flask app (`r.py`, `templates/`, `author/auth.csv`) is untouched and no longer needed by the static site.
