# Law School Rankings

Law schools ranked by where their current faculty publish (CSrankings-style), using HeinOnline metadata and the Washington & Lee law journal rankings.

Live at **https://nathanreitinger.github.io/lawRankings/** (GitHub Pages, branch `main`, folder `/docs`). The site is static; rankings are computed in the browser from `docs/data/`.
The old address, lawschoolrankings.pythonanywhere.com, redirects there (`pythonanywhere_wsgi.py`).

## Updating the data

The scrapers live in `scrape/main.py` (two folders up, not in this repo; see `scrape/PATCHES.md`). From `scrape/`:

```bash
python main.py --check      # dry run against HeinOnline (log in when Chrome opens), saves pages to check_output/
python main.py --no-push    # update everything and rebuild docs/data, without publishing
python main.py              # update everything, rebuild docs/data, commit + push (the site updates)
```

One run: W&L ranks -> US News list (via TaxProf Blog) -> Hein links for newly ranked journals -> journals
(incremental, into `scrape/journal_store/`) -> faculty lists (refreshed every 120 days) -> `build_data.py --publish`.
If it stops, run it again; it picks up where it left off.

`build_data.py` reads:

| input | from | used for |
|---|---|---|
| `journal_store/` | `get_papers()` + `journal_store.py` | papers; one repaired, incremental store per journal |
| `faculty_runs/authors_<date>.csv` (older: `authors_latest.csv`) | `get_authors_from_v3()` (Hein AuthorBySchool) | who teaches where; papers are credited to the author's *current* school |
| newest `rankings_<year>.csv` | `update_WandL()` | specialty journal ranks and subjects; which journals are General (flagship) |
| newest `usnews_<edition>.csv` / `usnews_<edition>_manual.csv` | `update_usnews()` / `usnews_manual.py` | which schools count as US law schools; flagship ranks |
| `scrape/flagship_schools.csv` | checked by hand (Oct 2026) | which school publishes each General journal, and whether it is the school's main law review, an online edition, a second journal, or not a school's journal |

**Journal ranks are fixed, one source per kind of journal; the site offers no other method.** Flagship law
reviews (a school's main law review) take their school's US News rank and come in tiers 1-3, 4-25, 26-50 and 51
and above (unranked schools go in the last one); the default view counts tiers 1-3 and 4-25. Online editions and
other general journals are their own tier, off by default. Specialty journals take their W&L rank. A General
journal missing from `flagship_schools.csv` is printed by the build and counted with the other general journals
until it is added.

Every build that changes the data gets the next build number (shown as "Volume 2 · Build n" in the masthead)
and an entry in `docs/data/history.json`, shown on `history.html`.

## Things the build fixes or flags

- Old-scraper damage (leaked and mislabeled volumes) is repaired in `scrape/journal_store/`; see `scrape/PATCHES.md`.
- Hein listing the same papers under two volume numbers in one year: counted once.
- Author matching: exact Hein name first, then first + last name when that is one person and middle initials don't conflict, then the same ignoring a "Jr."/"III" one side leaves off. Hyphens, apostrophes and accents are folded. Ambiguous names are skipped (counts are printed).
- A person on two faculty lists (they moved) counts only at the school on the newest list.
- Short pieces (forewords, tributes, book reviews, responses, ...) are flagged by title in `papers.minor`; the site can hide them. Page counts are not scraped yet, which would be a better test.
- Specialty groups: edit `SUBJECT_GROUPS` in `build_data.py`. New W&L subjects that aren't listed go to "Other" and are printed.

The old Flask app (`r.py`, `templates/`, `author/auth.csv`) is untouched and no longer needed by the static site.
