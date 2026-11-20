# NBA Trade Desk

An NBA trade machine with live rosters and contracts. It checks every trade against the 2026-27 CBA rules and explains in plain English why a deal fails and how to fix it. A time machine lets you fast-forward the league date so recently signed players become eligible.

## Features

- All 30 rosters: height, weight, position, age, experience, season stats, and contract (salary, years, options, year-by-year breakdown)
- Rule checks: salary matching by payroll tier (under cap, over cap, 1st-apron 100% rule, 2nd-apron no-aggregation), roster limits, newly signed and extension trade freezes, the 2-month aggregation freeze after a trade, 10-day contracts, and the trade deadline
- Plain-English explanations with one-click fixes: fast-forward to the eligibility date, or add a player that makes the salaries work
- 2 to 4 team trades, league-wide player search, and "Make trade" to play out a season (saved in your browser)
- Separate desktop (three-pane desk) and mobile (tabbed app) layouts

## Data

`build.sh` pulls rosters, stats and transactions from ESPN's public API and contracts from Basketball-Reference, then writes `data.json`. A GitHub Action (`.github/workflows/refresh.yml`) runs it every morning and commits the new data, so the GitHub Pages site stays current.

Run it yourself (needs `bash`, `curl`, `jq`):

```bash
bash build.sh
```

Then serve the folder with any static server and open `index.html`.

## Notes

2026-27 cap figures come from the NBA's July 2026 release. The salary-matching bands, the Feb 4, 2027 deadline and the Finals end date are estimates. Draft picks, cash, trade exceptions and exception hard caps are not modelled yet.
