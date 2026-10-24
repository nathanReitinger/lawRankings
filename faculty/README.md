# The faculty list

Law School Rankings credits each article to the school where its author teaches now. Who teaches where comes
from HeinOnline's faculty lists by school, refreshed by the update script, plus the corrections in **`edits.csv`**,
which anyone can propose. (This works like [CSrankings' faculty list](https://github.com/emeryberger/CSrankings).)

- `list-a.csv` ... `list-z.csv`: everyone on the lists the current site uses, one file per first letter of the
  last name. These files are rewritten by every build, so **don't edit them**; edit `edits.csv` instead.
- `edits.csv`: corrections, applied on top of HeinOnline's lists in every build.

## How to propose a change

1. Open [`edits.csv`](edits.csv) on GitHub and click the pencil ("Edit this file"). GitHub makes a copy for you.
2. Add one line per change (see below), then "Propose changes" and "Create pull request".
3. The maintainer reviews it; once merged, the next build applies it.

Not on GitHub, or not sure? Email [Nathan Reitinger](mailto:nathan.reitinger@law.northwestern.edu?subject=Law%20School%20Rankings%20faculty%20list).

## Columns

| column | what goes in it |
|---|---|
| `action` | `add`, `remove`, `move`, `alias` or `homepage` |
| `hein_name` | the person's name exactly as HeinOnline writes it on their author page: `Last, First Middle` |
| `school` | the school exactly as it is written in `list-*.csv` (for `add`, `move`, and optionally `remove`) |
| `name` | for `alias` only: the person's name as it is on the list |
| `homepage` | for `homepage` only: a link to their faculty page |
| `note` | why (a link to the faculty page helps the review) |

## Examples

```csv
action,hein_name,school,name,homepage,note
add,"Doe, Jane A.",Northwestern University,,,joined in 2026: https://law.example.edu/faculty/doe
remove,"Roe, Richard",Example University,,,emeritus since 2024
move,"Poe, Pat",University of Michigan,,,moved from Example University in 2026
alias,"Smith, John Q.",Example University,"Smith, John",,HeinOnline also lists his articles under this spelling
homepage,"Doe, Jane A.",,,https://law.example.edu/faculty/doe,
```

- **add**: puts the person on that school's list (a second school for a joint appointment is fine).
- **remove**: takes the person off that school's list (every school if `school` is empty).
- **move**: takes the person off every list and puts them on this school's list.
- **alias**: another HeinOnline spelling of a person already on the list, so articles written under that spelling
  are credited to them. Use it when the site misses some of someone's articles.
- **homepage**: a link shown next to the person's name on the site.
