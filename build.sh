#!/bin/bash
# Pulls live NBA rosters, contracts, season stats and 2026 transactions (ESPN public API)
# plus 2026-27+ salaries (Basketball-Reference) and writes data.json for the trade machine.
set -e
cd "$(dirname "$0")"
mkdir -p raw
for i in $(seq 1 30); do
  curl -sf "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/$i/roster" -o raw/roster_$i.json &
  curl -sf "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/$i" -o raw/team_$i.json &
done
curl -sf "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&page=1&limit=1000&sort=offensive.avgPoints:desc&seasontype=2" -o raw/stats.json &
curl -sf "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/transactions?limit=1000" -o raw/tx.json &
curl -sf -A "Mozilla/5.0" "https://www.basketball-reference.com/contracts/players.html" -o raw/bref.html &
wait
# Basketball-Reference contracts -> name|team|y1..y6 (suffix P=player option, T=team option, E=ETO)
tr -d '\n' < raw/bref.html | sed 's/<tr/\n<tr/g' | grep "data-stat=\"player\" ><a" \
 | sed -E "s/.*<a href='[^']*'>([^<]*)<\/a>.*data-stat=\"team_id\" ><a [^>]*>([A-Z]+)<.*/\1|\2|&/" \
 | awk -F'|' '{ out=$1"|"$2; row=$3;
   for(y=1;y<=6;y++){ v="";
     if (match(row, "class=\"[^\"]*\" data-stat=\"y" y "\"[^>]*>[^<]*")) { s=substr(row,RSTART,RLENGTH); c="";
       if (s ~ /salary-pl/) c="P"; else if (s ~ /salary-tm/) c="T"; else if (s ~ /salary-et/) c="E";
       sub(/.*>/,"",s); gsub(/[$,]/,"",s); if (s!="") v=s c }
     out=out"|"v }
   print out }' > raw/bref.psv
jq -R 'split("|")' raw/bref.psv | jq -s . > raw/bref.json
{
  for i in $(seq 1 30); do
    jq -c --slurpfile r raw/roster_$i.json '.team | {id, abbr: .abbreviation, name: .displayName, short: .name, loc: .location, color, alt: .alternateColor, record: (.record.items[0].summary // ""),
      players: [$r[0].athletes[] | {id, name: .displayName, pos: .position.abbreviation, jersey, ht: .displayHeight, wt: .displayWeight, age, exp: .experience.years,
        inj: ([.injuries[]?.status] | first), prev: ([.contracts[]? | select(.season.year==2026) | .salary] | first),
        c: (if .contract then {sal: .contract.salary, inV: .contract.incomingTradeValue, outV: .contract.outgoingTradeValue, yrs: .contract.yearsRemaining, kick: (if .contract.tradeKicker.active then .contract.tradeKicker.percentage else 0 end), prev: ([.contracts[]? | select(.season.year==2026) | .salary] | first)} else null end)}]}' raw/team_$i.json
  done
} | jq -s --slurpfile st raw/stats.json --slurpfile tx raw/tx.json --slurpfile br raw/bref.json '
  ($st[0].athletes | map({key: .athlete.id, value: (
     (.categories|map({key:.name, value:.values})|from_entries) as $c |
     [$c.general[0], $c.general[1], $c.offensive[0], $c.general[11], $c.offensive[10], $c.offensive[3], $c.offensive[6], $c.defensive[0], $c.defensive[1]] | map(. * 10 | round / 10))}) | from_entries) as $stats
  | {updated: (now|todate), season: $tx[0].season.displayName,
     tx: [$tx[0].transactions[] | [.date[0:10], .team.abbreviation, .description]],
     sal: $br[0],
     teams: map(.players |= map(. + {st: $stats[.id]}))}' > data.json
echo "teams: $(jq '.teams|length' data.json)  players: $(jq '[.teams[].players[]]|length' data.json)  size: $(wc -c < data.json)"
