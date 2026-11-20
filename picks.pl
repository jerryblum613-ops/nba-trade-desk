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
    my $rw = $rnd == 1 ? "1st" : "2nd";
    my ($tags, $note, $about) = ("", "", $orig);
    # Each trade that moved a pick is its own block. Inside a block each acquiring team's list has its own
    # footnotes (*, **, ...), so a note is read only from the same team's section, after the pick is named.
    my @blocks = split /<table class="draft_trade/, join(" ", @cells[4..$#cells]);
    my %bk = reverse %ab;
    SEARCH: for my $who ($orig, grep { $_ ne $orig } @own) {
      for my $blk (@blocks) {
        (my $text = $blk) =~ s/<[^>]*>/ /g;
        $text =~ s/&#039;/'/g; $text =~ s/&amp;/&/g; $text =~ s/\s+/ /g;
        next unless $text =~ /$year $rw round pick \($who\)((?: \[[A-Za-z ]+\])*)(\**)/;
        my ($t1, $stars, $pos) = ($1, $2, $+[0]);
        next if $who ne $orig && $t1 !~ /Swap/;   # another team's pick only explains this one through a swap
        next unless $stars;   # a later trade may just pass the pick along; keep looking for the one that set its terms
        $tags = $t1; $tags =~ s/^\s+|[\[\]]//g; $tags =~ s/\s+/ /g; $about = $who;
        {
          my $sect = substr($text, $pos);
          $sect =~ s/\s\S+(?:\s\S+){0,3} Acquire:.*$//;   # stop at the next team's section
          my $q = quotemeta($stars); my @n;
          while ($sect =~ /(?<!\*)$q(?!\*)(Protected Details|Conditions|Swap Option Details|Protected Result|Conditional Result|Swap Option Result): (.+?)(?=\s\*|$)/g) {
            my ($k, $t) = ($1, $2); $t =~ s/\s*Trade Exceptions Generated.*$//; $t =~ s/\s+$//; next if $k =~ /Result/ && $t =~ /^(Pending|Not Swapped)\b/;
            $t = "Result: $t" if $k =~ /Result/;
            push @n, $t unless grep { $_ eq $t } @n;
          }
          $note = join(" ", @n);
        }
        last SEARCH;
      }
    }
    # Last resort: a pick tied to another team's pick (e.g. "least favorable of MIL/NOP") is listed under
    # that other team's abbreviation; use the first such note that names this pick's team.
    if ($note eq "") {
      FALLBACK: for my $blk (@blocks) {
        (my $text = $blk) =~ s/<[^>]*>/ /g;
        $text =~ s/&#039;/'/g; $text =~ s/&amp;/&/g; $text =~ s/\s+/ /g;
        while ($text =~ /$year $rw round pick \(([A-Z]{3})\)((?: \[[A-Za-z ]+\])*)(\*+)/g) {
          my ($t1, $stars, $pos) = ($2, $3, $+[0]);
          my $sect = substr($text, $pos); $sect =~ s/\s\S+(?:\s\S+){0,3} Acquire:.*$//;
          my $q = quotemeta($stars);
          next unless $sect =~ /(?<!\*)$q(?!\*)(?:Protected Details|Conditions|Swap Option Details): (.+?)(?=\s\*|$)/;
          my $cand = $1;
          my ($full) = grep { $ab{$_} eq $orig } sort keys %ab; my @w = split / /, $full; my $alt = join("|", map { quotemeta } ($orig, $w[-1], join(" ", @w[0..$#w-1])));
          if ($cand =~ /\b(?:$alt)\b/) {
            ($note = $cand) =~ s/\s*Trade Exceptions Generated.*$//; $note =~ s/\s+$//; ($tags = $t1) =~ s/^\s+|[\[\]]//g; $tags =~ s/\s+/ /g; last FALLBACK;
          }
        }
      }
    }
    $note = substr($note, 0, 400);
    print "{\"y\":$year,\"r\":$rnd,\"own\":[" . join(",", map { "\"$_\"" } @own) . "],\"orig\":\"$orig\",\"about\":\"$about\",\"tbd\":$tbd,\"tags\":" . js($tags) . ",\"note\":" . js($note) . "}\n";
  }
}
