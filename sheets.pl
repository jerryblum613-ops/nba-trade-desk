#!/usr/bin/perl
# Parses Salary Swish team cap sheets (raw/sheets/<slug>.html) into one JSON object keyed by ESPN team abbreviation:
# {ABBR: {cap, dead, players: [[name, status, method, [terms], [[amount, option], ...]]]}}
# cap = official team cap number (includes dead money); option is "", "P" (player), "T" (team) or "E" (early termination).
use strict; use warnings;
my %abbr = (bucks=>"MIL",bulls=>"CHI",cavaliers=>"CLE",celtics=>"BOS",clippers=>"LAC",grizzlies=>"MEM",hawks=>"ATL",heat=>"MIA",hornets=>"CHA",jazz=>"UTAH",kings=>"SAC",knicks=>"NY",lakers=>"LAL",magic=>"ORL",mavericks=>"DAL",nets=>"BKN",nuggets=>"DEN",pacers=>"IND",pelicans=>"NO",pistons=>"DET",raptors=>"TOR",rockets=>"HOU",sixers=>"PHI",spurs=>"SA",suns=>"PHX",thunder=>"OKC",timberwolves=>"MIN",trailblazers=>"POR",warriors=>"GS",wizards=>"WSH");
sub js { my $s = shift; $s =~ s/\\/\\\\/g; $s =~ s/"/\\"/g; return "\"$s\""; }
sub num { my $s = shift // ""; $s =~ s/[^0-9]//g; return $s eq "" ? 0 : $s + 0; }
my @out;
for my $slug (sort keys %abbr) {
  open(my $fh, "<", "raw/sheets/$slug.html") or next; local $/; my $h = <$fh>; close $fh;
  $h =~ s/\n/ /g;
  (my $txt = $h) =~ s/<[^>]*>/ /g; $txt =~ s/\s+/ /g;
  my ($cap) = $txt =~ /CAP HIT : \$([\d,]+)/; next unless $cap;
  my ($dead) = $txt =~ /DEAD CAP HIT (\$[\d,]+|-)/;
  my @players; my %seen;
  for my $row (split /<tr/, $h) {
    my @c = split /<td/, $row;
    next unless @c > 8 && $c[2] =~ /^>(Roster|Two-Way)</;
    my $status = $1;
    my ($name) = $c[1] =~ /players\/[^"]*">([^<]+)</ or next;
    $name =~ s/&#039;/'/g; $name =~ s/&amp;/&/g;
    if ($name =~ /^(.*?), (.*)$/) {   # "Bagley III, Marvin" -> "Marvin Bagley III"
      $name = "$2 $1";
    }
    next if $seen{$name}++;
    my ($method) = $c[3] =~ />([A-Za-z -]+)</; $method //= "";
    my @terms = $c[6] =~ /title="([^"]*)"/g;
    my @years;
    for my $i (7 .. 12) {
      my $cell = $c[$i] // ""; last if $cell =~ /freeAgentTag|>UFA<|>RFA</;
      my ($amt) = $cell =~ /class="cap_hit[^"]*"[^>]*>([^<]*)/; last unless defined $amt && $amt =~ /\d/;
      my $opt = ""; if ($cell =~ /team_option_tag[^"]*">\s*([PTE])\s*</) { $opt = $1; }
      push @years, "[" . num($amt) . "," . js($opt) . "]";
    }
    push @players, "[" . join(",", js($name), js($status), js($method), "[" . join(",", map { js($_) } @terms) . "]", "[" . join(",", @years) . "]") . "]";
  }
  push @out, js($abbr{$slug}) . ":{\"cap\":" . num($cap) . ",\"dead\":" . num($dead) . ",\"players\":[" . join(",", @players) . "]}";
}
print "{" . join(",", @out) . "}\n";
