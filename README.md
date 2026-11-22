# NBA Trade Desk

An NBA trade machine with live rosters and contracts. It checks every trade against the 2026-27 CBA rules and explains in plain English why a deal fails and how to fix it. A time machine lets you fast-forward the league date so recently signed players become eligible.

## Features

- All 30 rosters: height, weight, position, age, experience, season stats, and contract (salary, years, options, year-by-year breakdown)
- Rule checks: salary matching by payroll tier (under cap, over cap, 1st-apron 100% rule, 2nd-apron no-aggregation), roster limits, newly signed and extension trade freezes, the 2-month aggregation freeze after a trade, 10-day contracts, and the trade deadline
- Plain-English explanations with one-click fixes: fast-forward to the eligibility date, or add a player that makes the salaries work
- Draft picks: every team's 2027-2033 firsts and seconds with current owners and protections, checked against the Stepien rule, the frozen 7-years-out first for second-apron teams, and the draft date
- Pick swaps: trade swap rights a team holds, or offer a new swap on a pick a team owns (both teams must own that year's pick; frozen picks can't be swapped)
- 2 to 4 team trades and league-wide player search. Completing a trade saves a PNG image of it (players with height, stats and contracts; picks and swaps with their terms; cash; salary, payroll and roster before and after; any rule problems). Rosters always stay as they really are.
- Every protected, conditional or swap pick has a plain-English explanation (`pick-terms.json`). Each one is tied to the source note it was written for, so if Salary Swish changes a pick's terms, the page falls back to a cleaned-up version of the new note instead of showing a stale explanation.
- Separate desktop (three-pane desk) and mobile (tabbed app) layouts

## Data

`build.sh` pulls rosters, stats and transactions from ESPN's public API and contracts, options, two-way deals and dead money from Salary Swish team cap sheets (`sheets.pl`; Basketball-Reference as a backup), and future pick ownership from Salary Swish (`picks.pl`), then writes `data.json`. A GitHub Action (`.github/workflows/refresh.yml`) runs it every morning and commits the new data, so the GitHub Pages site stays current.

Run it yourself (needs `bash`, `curl`, `jq`, `perl`):

```bash
bash build.sh
```

Then serve the folder with any static server and open `index.html`.

## Notes

2026-27 cap figures come from the NBA's July 2026 release. The Feb 11, 2027 trade deadline is official. The salary-matching bands follow the CBA formula scaled to the 2026-27 cap; the 2027 Finals and draft dates are estimates until the NBA announces them. Pick ownership and terms come from Salary Swish; every conditional pick shows what it depends on. Swap rights can be traded, and new swaps can be offered on a pick a team owns. Cash limits, trade exceptions and hard caps are checked too, using Salary Swish's trade exception and hard cap trackers (parsed by `trackers.pl`).
