#!/usr/bin/perl
# Parses Salary Swish draft pages (raw/ss<year>.html) into JSON lines: one per future pick.
use strict; use warnings;
my %ab = ("Atlanta Hawks"=>"ATL","Boston Celtics"=>"BOS","Brooklyn Nets"=>"BKN","Charlotte Hornets"=>"CHA","Chicago Bulls"=>"CHI","Cleveland Cavaliers"=>"CLE","Dallas Mavericks"=>"DAL","Denver Nuggets"=>"DEN","Detroit Pistons"=>"DET","Golden State Warriors"=>"GSW","Houston Rockets"=>"HOU","Indiana Pacers"=>"IND","LA Clippers"=>"LAC","Los Angeles Clippers"=>"LAC","Los Angeles Lakers"=>"LAL","Memphis Grizzlies"=>"MEM","Miami Heat"=>"MIA","Milwaukee Bucks"=>"MIL","Minnesota Timberwolves"=>"MIN","New Orleans Pelicans"=>"NOP","New York Knicks"=>"NYK","Oklahoma City Thunder"=>"OKC","Orlando Magic"=>"ORL","Philadelphia 76ers"=>"PHI","Phoenix Suns"=>"PHX","Portland Trail Blazers"=>"POR","Sacramento Kings"=>"SAC","San Antonio Spurs"=>"SAS","Toronto Raptors"=>"TOR","Utah Jazz"=>"UTA","Washington Wizards"=>"WAS");
sub js { my $s = shift; $s =~ s/\\/\\\\/g; $s =~ s/"/\\"/g; $s =~ s/[\x00-\x1f]/ /g; return "\"$s\""; }
for my $year (@ARGV) {
  open(my $fh, "<", "raw/ss$year.html") or next; local $/; my $html = <$fh>; close $fh;
  $html =~ s/\n/ /g;
  my @rows = split /(?=<tr id="dp_)/, $html; shift @rows;
  for my $row (@rows) {
    my ($rnd) = $row =~ /class="[^"]*\br_(\d)_\d+/; next unless $rnd;
    my @cells = split /<td/, $row;
    my $teamCell = $cells[2] // ""; my $origCell = $cells[3] // "";
    my @own = map { $ab{$_} // () } ($teamCell =~ /title="([^"]+)"/g);
    my ($origName) = $origCell =~ /title="([^"]+)"/; next unless $origName && $ab{$origName};
    my $orig = $ab{$origName};
    my $tbd = $teamCell =~ /TBD/ ? 1 : 0;
    my %seen; @own = grep { !$seen{$_}++ } @own;
    (my $text = join(" ", @cells[4..$#cells])) =~ s/<[^>]*>/ /g;
    $text =~ s/&#039;/'/g; $text =~ s/&amp;/&/g; $text =~ s/\s+/ /g;
    my $rw = $rnd == 1 ? "1st" : "2nd";
    my ($tags, $note) = ("", "");
    if ($text =~ /$year $rw round pick \($orig\)((?: \[[A-Za-z ]+\])*)(\**)/) {
      $tags = $1; my $stars = $2; $tags =~ s/^\s+|[\[\]]//g; $tags =~ s/\s+/ /g;
      if ($stars) { my $q = quotemeta($stars); if ($text =~ /(?<!\*)$q(?:Protected Details|Conditions|Swap Option Details): ([^*]+)/) { $note = $1; $note =~ s/\s+$//; } }
    }
    $note = substr($note, 0, 220);
    print "{\"y\":$year,\"r\":$rnd,\"own\":[" . join(",", map { "\"$_\"" } @own) . "],\"orig\":\"$orig\",\"tbd\":$tbd,\"tags\":" . js($tags) . ",\"note\":" . js($note) . "}\n";
  }
}
