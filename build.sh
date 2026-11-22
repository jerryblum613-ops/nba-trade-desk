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
# Salary Swish draft pages: who owns each traded future pick, with protections
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
PICK_YEARS="2027 2028 2029 2030 2031 2032 2033"
for y in $PICK_YEARS; do curl -sf -A "$UA" "https://www.salaryswish.com/draft/$y" -o raw/ss$y.html &
done
# Salary Swish trackers: open trade exceptions and which teams are hard-capped
curl -sf -A "$UA" "https://www.salaryswish.com/trade-exception" -o raw/tpe.html &
curl -sf -A "$UA" "https://www.salaryswish.com/hard-cap-tracker" -o raw/hardcap.html &
# Salary Swish team cap sheets: exact cap hits, options, two-way deals, dead money
mkdir -p raw/sheets
for s in bucks bulls cavaliers celtics clippers grizzlies hawks heat hornets jazz kings knicks lakers magic mavericks nets nuggets pacers pelicans pistons raptors rockets sixers spurs suns thunder timberwolves trailblazers warriors wizards; do
  curl -sf -A "$UA" "https://www.salaryswish.com/teams/$s" -o raw/sheets/$s.html &
done
wait
perl trackers.pl > raw/trackers.json || echo '{"tpe":[],"hardcap":{}}' > raw/trackers.json
perl sheets.pl > raw/sheets.json 2>/dev/null || echo '{}' > raw/sheets.json
if [ "$(jq 'length' raw/sheets.json)" -lt 28 ] && [ -f data.json ] && jq -e '.sheets' data.json > /dev/null 2>&1; then jq -c '.sheets' data.json > raw/sheets.json; echo "Cap sheets unavailable; kept previous"; fi
perl picks.pl $PICK_YEARS > raw/picks.jsonl || : > raw/picks.jsonl
# Full pick grid: every team's own 1st and 2nd for 2027-2033, with current owner if traded
jq -n -c --slurpfile p raw/picks.jsonl '
  def esp: {"GSW":"GS","NOP":"NO","NYK":"NY","SAS":"SA","UTA":"UTAH","WAS":"WSH"}[.] // .;
  ($p | map({key: "\(.y)-\(.r)-\(.orig)", value: .}) | from_entries) as $m
  | [range(2027; 2034) as $y | range(1; 3) as $r
     | ("ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS" | split(" "))[] as $t
     | $m["\($y)-\($r)-\($t)"] as $x
     | (($x.own // [$t]) as $o | if (($x.tags // "") | test("Swap")) and ($o | index($t)) then $t else $o[0] end) as $own
     | [$y, $r, ($t|esp), ($own|esp), (($x.own // []) | map(select(. != $own)) | map(esp)), ($x.tags // ""), ($x.note // "")]]' > raw/picks.json
# If a source was unreachable, keep yesterday's picks, exceptions and hard caps instead of wiping them
if [ "$(wc -l < raw/picks.jsonl)" -lt 100 ] && [ -f data.json ] && jq -e '.picks' data.json > /dev/null 2>&1; then jq -c '.picks' data.json > raw/picks.json; echo "Pick source unavailable; kept previous picks"; fi
if [ "$(jq '.tpe|length' raw/trackers.json)" -eq 0 ] && [ -f data.json ] && jq -e '.tpe' data.json > /dev/null 2>&1; then jq -c '{tpe: .tpe, hardcap: (.hardcap // {})}' data.json > raw/trackers.json; echo "Tracker source unavailable; kept previous exceptions and hard caps"; fi
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
} | jq -s --slurpfile st raw/stats.json --slurpfile tx raw/tx.json --slurpfile br raw/bref.json --slurpfile pk raw/picks.json --slurpfile tk raw/trackers.json --slurpfile sh raw/sheets.json '
  ($st[0].athletes | map({key: .athlete.id, value: (
     (.categories|map({key:.name, value:.values})|from_entries) as $c |
     [$c.general[0], $c.general[1], $c.offensive[0], $c.general[11], $c.offensive[10], $c.offensive[3], $c.offensive[6], $c.defensive[0], $c.defensive[1]] | map(. * 10 | round / 10))}) | from_entries) as $stats
  | {updated: (now|todate), season: $tx[0].season.displayName,
     tx: [$tx[0].transactions[] | [.date[0:10], .team.abbreviation, .description]],
     sal: $br[0], picks: $pk[0], tpe: $tk[0].tpe, hardcap: $tk[0].hardcap, sheets: $sh[0],
     teams: map(.players |= map(. + {st: $stats[.id]}))}' > data.json
echo "teams: $(jq '.teams|length' data.json)  players: $(jq '[.teams[].players[]]|length' data.json)  size: $(wc -c < data.json)"
