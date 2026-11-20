#!/usr/bin/perl
# Parses Salary Swish's trade exception and hard cap trackers (raw/tpe.html, raw/hardcap.html) into one JSON object.
use strict; use warnings;
my %esp = (GSW=>"GS", NOP=>"NO", NYK=>"NY", SAS=>"SA", UTA=>"UTAH", WAS=>"WSH");
my %ab = ("Atlanta Hawks"=>"ATL","Boston Celtics"=>"BOS","Brooklyn Nets"=>"BKN","Charlotte Hornets"=>"CHA","Chicago Bulls"=>"CHI","Cleveland Cavaliers"=>"CLE","Dallas Mavericks"=>"DAL","Denver Nuggets"=>"DEN","Detroit Pistons"=>"DET","Golden State Warriors"=>"GSW","Houston Rockets"=>"HOU","Indiana Pacers"=>"IND","LA Clippers"=>"LAC","Los Angeles Lakers"=>"LAL","Memphis Grizzlies"=>"MEM","Miami Heat"=>"MIA","Milwaukee Bucks"=>"MIL","Minnesota Timberwolves"=>"MIN","New Orleans Pelicans"=>"NOP","New York Knicks"=>"NYK","Oklahoma City Thunder"=>"OKC","Orlando Magic"=>"ORL","Philadelphia 76ers"=>"PHI","Phoenix Suns"=>"PHX","Portland Trail Blazers"=>"POR","Sacramento Kings"=>"SAC","San Antonio Spurs"=>"SAS","Toronto Raptors"=>"TOR","Utah Jazz"=>"UTA","Washington Wizards"=>"WAS");
sub e { my $a = shift; return $esp{$a} // $a; }
sub js { my $s = shift; $s =~ s/\\/\\\\/g; $s =~ s/"/\\"/g; return "\"$s\""; }
my %mon = (Jan=>1,Feb=>2,Mar=>3,Apr=>4,May=>5,Jun=>6,Jul=>7,Aug=>8,Sep=>9,Oct=>10,Nov=>11,Dec=>12);
sub iso { my ($m, $d, $y) = $_[0] =~ /(\w{3}) (\d+), (\d{4})/ or return ""; return sprintf("%04d-%02d-%02d", $y, $mon{$m}, $d); }
local $/;
my @tpe;
if (open(my $fh, "<", "raw/tpe.html")) {
  my $h = <$fh>; $h =~ s/\n/ /g;
  for my $row (split /<tr/, $h) {
    (my $t = $row) =~ s/^[^>]*>//; $t =~ s/<[^>]*>/|/g; $t =~ s/&#039;/'/g; $t =~ s/&amp;/&/g; $t =~ s/\s*\|[\s|]*/|/g;
    my @f = grep { $_ ne "" } split /\|/, $t;
    next unless @f >= 8 && $ab{$f[0]} && $f[3] =~ /^\$/;
    my ($team, $who, $amt, $left, $start, $end) = (e($ab{$f[0]}), $f[2], $f[3], $f[5], iso($f[6]), iso($f[7]));
    ($amt, $left) = map { (my $x = $_) =~ s/[\$,\s]//g; $x } ($amt, $left);
    next unless $left > 0 && $end;
    push @tpe, "[" . join(",", js($team), js($who), $left, js($start), js($end)) . "]";
  }
}
my %hc;
if (open(my $fh, "<", "raw/hardcap.html")) {
  my $h = <$fh>; $h =~ s/<[^>]*>/ /g; $h =~ s/\s+/ /g;
  if ($h =~ /Teams Hard Capped: First apron:(.*?)Second apron:(.*?)1st Apron Triggers/) {
    my ($one, $two) = ($1, $2);
    for my $name (keys %ab) { $hc{e($ab{$name})} = 1 if index($one, $name) >= 0; $hc{e($ab{$name})} = 2 if index($two, $name) >= 0; }
  }
}
print "{\"tpe\":[" . join(",", @tpe) . "],\"hardcap\":{" . join(",", map { js($_) . ":$hc{$_}" } sort keys %hc) . "}}\n";
