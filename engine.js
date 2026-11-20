// NBA Trade Desk rules engine: data prep, trade eligibility and 2026-27 CBA trade checks.
// No DOM access here; app.js renders whatever this returns.
(function (global) {
"use strict";

// ---------- League constants (2026-27, per NBA release) ----------
const CAP = 164961000, TAX = 200428000, APRON1 = 209015000, APRON2 = 221686000;
// Salary-matching bands for teams over the cap but under the 1st apron after a trade (2023 CBA, Art. VII):
// out ≤ BAND1: 200% + $250K; BAND1–BAND2: out + BAND_ADD; > BAND2: 125% + $250K. The bands rise with the cap;
// 2025-26 was $8,277,000 / +$8,527,000 / $33,108,000, scaled here by the 2026-27 cap increase.
const CUSHION = 250000, BAND1 = 8829000, BAND_ADD = BAND1 + CUSHION, BAND2 = BAND1 * 4;
const MIN_SAL = 1358000; // estimated rookie minimum, used only when a salary is missing
const DAY = 86400000;
const d = s => new Date(s + "T12:00:00");
const TODAY = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12); })();
const DEC15 = d("2026-12-15"), JAN15 = d("2027-01-15"), DEADLINE = d("2027-02-04"), REOPEN = d("2027-06-21"), DRAFT = d("2027-06-24"), END = d("2027-06-30");
const PICK_FIRST = 2027, PICK_LAST = 2033; // teams may trade picks up to 7 drafts out
const START = TODAY < d("2026-07-06") ? d("2026-07-06") : TODAY > END ? END : TODAY;
const BREF_TEAM = {GSW: "GS", NOP: "NO", UTA: "UTAH", NYK: "NY", SAS: "SA", PHO: "PHX", BRK: "BKN", CHO: "CHA", WAS: "WSH"};
const SEASONS = ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31", "2031-32"];
const TIER = ["Under cap", "Over cap", "Taxpayer", "1st apron", "2nd apron"];

// ---------- helpers ----------
const money = (v, dp = 1) => v == null ? "—" : v === 0 ? "$0" : (v < 0 ? "−" : "") + "$" + (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(dp) + "M" : Math.round(Math.abs(v) / 1e3) + "K");
const fmtD = (dt, yr = true) => dt.toLocaleDateString("en-US", {month: "short", day: "numeric", ...(yr ? {year: "numeric"} : {})});
const addMonths = (dt, m) => { const x = new Date(dt); x.setMonth(x.getMonth() + m); return x; };
const maxD = (a, b) => a > b ? a : b;
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

// ---------- league state ----------
const L = {teams: {}, players: {}, picks: {}, swaps: {}, order: [], date: START, teamIds: [], sel: {}, psel: {}, wsel: {}, executed: []};
// L.sel: playerId -> destination team; L.psel: pickId -> destination team;
// L.wsel: swapId -> destination team (passing on a swap right it holds), or "new-YEAR-ROUND-TEAM" -> team that receives a new swap right
const SS_ABBR = {WAS: "WSH", UTA: "UTAH", SAS: "SA", NOP: "NO", NYK: "NY", GSW: "GS"};
function teamsNamed(text) {
  const out = [], t = String(text || "");
  const hits = [];
  for (const ab of Object.keys(L.teams)) {
    const tm = L.teams[ab], ss = Object.keys(SS_ABBR).find(k => SS_ABBR[k] === ab) || ab;
    for (const w of [ss, ab, tm.short, tm.loc]) { if (!w) continue; const i = t.search(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)); if (i >= 0) hits.push([i, ab]); }
  }
  hits.sort((a, b) => a[0] - b[0]);
  for (const [, ab] of hits) if (!out.includes(ab)) out.push(ab);
  return out;
}

function classify(s, name) {
  const i = s.toLowerCase().indexOf(name.toLowerCase());
  if (/^waived/i.test(s)) return null;
  const ex = s.search(/in exchange for|traded/i);
  if (ex >= 0 && i > ex) return null;
  if (/^converted/i.test(s)) return /two-way/i.test(s) ? "twoway" : "convert";
  if (/10-day/i.test(s)) return "tenday";
  if (/rookie scale extension/i.test(s)) return "rookieext";
  if (/veteran extension/i.test(s)) return "ext";
  if (/two-way/i.test(s)) return "twoway";
  if (/rookie scale contract/i.test(s)) return "rookie";
  if (/^re-signed/i.test(s)) return "resign";
  if (/^signed/i.test(s)) return /rest-of-season/i.test(s) ? "ros" : "fa";
  if (/^acquired/i.test(s)) return "trade";
  return null;
}

function load(data, executed) {
  L.teams = {}; L.players = {}; L.picks = {}; L.swaps = {}; L.sel = {}; L.psel = {}; L.wsel = {};
  for (const t of data.teams) L.teams[t.abbr] = {...t};   // names first, so notes can be read below
  for (const [y, r, orig, own, also, tags, note] of data.picks || [])
    L.picks[`${y}-${r}-${orig}`] = {id: `${y}-${r}-${orig}`, y, r, orig, own, also: also || [], tags: tags || "", note: note || "", acq: null, swap: null};
  // existing swap rights: the team named in the note (other than the pick's team) holds the option
  for (const k of Object.values(L.picks)) {
    if (!/Swap/.test(k.tags)) continue;
    // Notes read "X has the option to swap…", "X's right to swap…": the first involved team named holds the option.
    const involved = [k.orig, k.own, ...k.also], pool = involved.filter(x => x !== k.orig);
    const named = teamsNamed(k.note).filter(x => involved.includes(x));
    const holder = named[0] || pool[0];
    const grantor = holder === k.orig ? (named.find(x => x !== holder) || pool[0]) : k.orig;
    if (!holder || !grantor || holder === grantor) continue;
    const id = `sw-${k.y}-${k.r}-${grantor}-${holder}`;
    if (!L.swaps[id]) L.swaps[id] = {id, y: k.y, r: k.r, grantor, holder, note: k.note, pre: true};
    k.swap = id;
    const gp = L.picks[`${k.y}-${k.r}-${grantor}`]; if (gp && !gp.swap) gp.swap = id;
  }
  const salIdx = {};
  for (const r of data.sal) { const k = norm(r[0]); (salIdx[k] ||= []).push(r); }
  const sentences = data.tx.map(([date, team, desc]) => ({date: d(date), team, parts: desc.split(/\.\s+(?=[A-Z])/)}));
  for (const t of data.teams) {
    L.teams[t.abbr] = {...t, color: "#" + (t.color || "555555"), alt: "#" + (t.alt || "999999"), roster: []};
    for (const p of t.players) {
      const rows = salIdx[norm(p.name)] || [];
      const br = rows.find(r => (BREF_TEAM[r[1]] || r[1]) === t.abbr) || rows[0];
      const years = br ? br.slice(2).filter(Boolean).map(v => ({amt: +v.replace(/[A-Z]/g, ""), opt: v.replace(/[0-9]/g, "")})) : [];
      let sal = p.c?.sal ?? years[0]?.amt ?? null, est = false;
      if (p.c?.sal && years[0]) years[0].amt = p.c.sal;
      const yrs = years.length || (p.c ? p.c.yrs : 0);
      // most recent signing / acquisition this calendar year (transactions are newest first)
      let sig = null;
      const last = norm(p.name).split(" ").slice(-1)[0];
      const uniqueLast = t.players.filter(q => norm(q.name).endsWith(" " + last) || norm(q.name) === last).length === 1;
      for (const tx of sentences) {
        for (const part of tx.parts) {
          const full = part.toLowerCase().includes(p.name.toLowerCase());
          const byLast = !full && tx.team === t.abbr && last.length > 3 && uniqueLast && norm(part).split(" ").includes(last);
          if (!full && !byLast) continue;
          const kind = classify(part, full ? p.name : last);
          if (kind) { sig = {kind, date: tx.date, team: tx.team, text: part.replace(/\.?$/, ".")}; break; }
        }
        if (sig) break;
      }
      const twoway = (sig?.kind === "twoway" && !(sal > 2.5e6)) || (sal == null && !/rookie|fa|resign|ros|convert|trade|ext/.test(sig?.kind || ""));
      if (twoway) sal = 0;
      if (sal == null) { sal = MIN_SAL; est = true; }
      const pl = {...p, team: t.abbr, sal, est, years, yrs, twoway, sig, prevSal: p.prev ?? p.c?.prev ?? null,
        inV: twoway ? 0 : (p.c?.inV ?? sal), outV: twoway ? 0 : (p.c?.outV ?? sal), acq: null, key: norm(p.name)};
      L.players[p.id] = pl;
      L.teams[t.abbr].roster.push(p.id);
    }
  }
  L.order = Object.keys(L.teams).sort((a, b) => L.teams[a].name.localeCompare(L.teams[b].name));
  L.executed = [];
  for (const tr of executed || []) applyTrade(tr);
  if (L.executed.length) { const last = d(L.executed.at(-1).date); if (L.date < last) L.date = last; }
}

// ---------- rules ----------
const payroll = ab => L.teams[ab].roster.reduce((s, id) => s + (L.players[id].twoway ? 0 : L.players[id].sal), 0);
const tierOf = v => v <= CAP ? 0 : v <= TAX ? 1 : v <= APRON1 ? 2 : v <= APRON2 ? 3 : 4;
const windowOpen = dt => !(dt > DEADLINE && dt < REOPEN);
const minDate = () => L.executed.length ? maxD(START, d(L.executed.at(-1).date)) : START;

function elig(p, dt = L.date) {
  const ok = {ok: true, kind: "ok", label: "Tradable"};
  const aggFrom = p.acq || (p.sig?.kind === "trade" ? p.sig.date : null);
  if (aggFrom) {
    const until = addMonths(aggFrom, 2);
    if (dt < until) return {ok: true, kind: "agg", until, label: "Solo only till " + fmtD(until, false),
      why: `${p.name} was acquired in a trade on ${fmtD(aggFrom)}. He can be traded by himself, but his salary can't be combined with other players' until ${fmtD(until)} (2 months after the trade).`};
    if (p.acq) return ok;
  }
  const s = p.sig;
  if (!s) return ok;
  const signed = fmtD(s.date), who = p.name;
  if (s.kind === "tenday") return {ok: false, kind: "never", label: "10-day deal",
    why: `${who} is on a 10-day contract (signed ${signed}). Players on 10-day contracts can never be traded.`};
  let until = null, why = "";
  if (s.kind === "rookie") { until = new Date(+s.date + 30 * DAY); why = `${who} signed his rookie-scale deal on ${signed}. Drafted players can't be traded until 30 days after they sign.`; }
  else if (s.kind === "ext") { until = addMonths(s.date, 6); why = `${who} signed a veteran extension on ${signed}. A player who signs an extension can't be traded for 6 months.`; }
  else if (s.kind === "resign") {
    const raise = p.prevSal > 0 && p.sal > p.prevSal * 1.2, over = payroll(s.team in L.teams ? s.team : p.team) > CAP;
    if (raise && over) { until = maxD(JAN15, addMonths(s.date, 3)); why = `${who} re-signed on ${signed} with a raise of more than 20% (${money(p.prevSal)} → ${money(p.sal)}) while his team was over the cap. Those Bird-rights re-signings are frozen until the later of Jan 15 or 3 months after signing.`; }
    else { until = maxD(DEC15, addMonths(s.date, 3)); why = `${who} re-signed on ${signed}. Re-signed free agents can't be traded until the later of Dec 15 or 3 months after signing.`; }
  }
  else if (["fa", "ros", "convert", "twoway"].includes(s.kind)) {
    until = maxD(DEC15, addMonths(s.date, 3));
    why = `${who} ${s.kind === "convert" ? "had his deal converted to a standard contract" : s.kind === "twoway" ? "signed a two-way contract" : "signed as a free agent"} on ${signed}. Newly signed players can't be traded until the later of Dec 15 or 3 months after signing.`;
  }
  if (until && dt < until) return {ok: false, kind: "lock", until, label: "Eligible " + fmtD(until, false), why: why + ` He's eligible ${fmtD(until)}.`};
  return ok;
}

const teamName = ab => L.teams[ab]?.short || ab;
const pickLabel = k => `${k.y} ${k.r === 1 ? "1st" : "2nd"}${k.orig !== k.own ? ` (${teamName(k.orig)})` : ""}`;
const teamPicks = ab => Object.values(L.picks).filter(k => k.own === ab && !(k.y === 2027 && L.date > DRAFT)).sort((a, b) => a.y - b.y || a.r - b.r || (a.orig === ab ? -1 : 1));

// Plain-English terms for a conditional pick, with team codes turned into names.
function pickTerms(k) {
  const abbrs = {...Object.fromEntries(Object.keys(L.teams).map(a => [a, a])), ...SS_ABBR};
  const named = s => s.replace(/\b([A-Z]{2,4})\b(?!-)/g, (m, a) => abbrs[a] && L.teams[abbrs[a]] ? L.teams[abbrs[a]].short : m).replace(/s's\b/g, "s'");
  if (k.note) return named(k.note.replace(/1st RD/g, "1st round").replace(/2nd RD/g, "2nd round"));
  if (k.also.length) return `Who ends up with this pick depends on terms between the ${[k.own, ...k.also].map(teamName).join(" and the ")}. The source doesn't list the exact terms.`;
  return "";
}
const isConditional = k => k.also.length > 0 || /Protected|Conditional|Swap/.test(k.tags);
// Does this team hold a first-round pick in year y for Stepien purposes? Its own pick counts even if another team
// holds a swap on it (it still gets a first). Another team's pick counts only if nothing can stop it from conveying.
function holdsFirst(ab, y, psel = L.psel) {
  return Object.values(L.picks).some(k => {
    if (k.r !== 1 || k.y !== y) return false;
    const owner = psel[k.id] || k.own;
    if (owner !== ab) return false;
    if (k.orig === ab) return true;
    return !/Protected|Conditional/.test(k.tags) && !(k.also.length && !/Swap/.test(k.tags));
  });
}
const swapLabel = s => `${s.y} ${s.r === 1 ? "1st" : "2nd"}-round swap with the ${teamName(s.grantor)}`;
function swapFromKey(key) { // "new-2029-1-MIL" or an existing swap id
  if (L.swaps[key]) return L.swaps[key];
  const m = /^new-(\d{4})-(\d)-(.+)$/.exec(key); if (!m) return null;
  return {id: key, y: +m[1], r: +m[2], grantor: m[3], holder: null, note: "", pre: false, isNew: true};
}

function evaluate(sel = L.sel, psel = L.psel, wsel = L.wsel) {
  const ids = Object.keys(sel), pids = Object.keys(psel), wids = Object.keys(wsel), issues = [], warns = [], summary = {};
  for (const ab of L.teamIds) summary[ab] = {out: [], inc: [], outV: 0, inV: 0, pOut: [], pIn: [], wOut: [], wIn: []};
  for (const id of wids) {
    const s = swapFromKey(id), to = wsel[id]; if (!s) continue;
    const from = s.isNew ? s.grantor : s.holder;
    if (!summary[from] || !summary[to]) continue;
    summary[from].wOut.push({...s, to}); summary[to].wIn.push({...s, to});
  }
  for (const id of ids) {
    const p = L.players[id], to = sel[id];
    if (!summary[p.team] || !summary[to]) continue;
    summary[p.team].out.push(p); summary[p.team].outV += p.outV;
    summary[to].inc.push(p); summary[to].inV += p.inV;
  }
  for (const id of pids) {
    const k = L.picks[id], to = psel[id];
    if (!k || !summary[k.own] || !summary[to]) continue;
    summary[k.own].pOut.push(k); summary[to].pIn.push(k);
  }
  if ((!ids.length && !pids.length && !wids.length) || L.teamIds.length < 2) return {state: "idle", issues, warns, summary};
  const dt = L.date;
  if (!windowOpen(dt)) issues.push({kind: "window", h: "The trade deadline has passed",
    p: `The 2026-27 deadline is ${fmtD(DEADLINE)} (estimated). No trades can be made from the day after the deadline until the NBA Finals end, around ${fmtD(REOPEN)}. Move the league date back before the deadline, or past the Finals.`,
    fix: [["Go to deadline day", +DEADLINE], ["Jump past the Finals", +REOPEN]]});
  for (const id of ids) {
    const p = L.players[id], e = elig(p, dt);
    if (e.ok) continue;
    const late = e.until && e.until > DEADLINE && e.until < REOPEN && dt <= DEADLINE, go = late ? REOPEN : e.until;
    issues.push({kind: "elig", pid: id, h: `${p.name} isn't eligible to be traded yet`,
      p: e.why + (late ? ` That's after the ${fmtD(DEADLINE, false)} deadline, so he can't be moved again until the trade window reopens after the Finals.` : ""),
      fix: go ? [[`Fast-forward to ${fmtD(go, false)}`, +go]] : []});
  }
  for (const ab of L.teamIds) {
    const t = L.teams[ab], s = summary[ab], name = t.short;
    if (!s.out.length && !s.inc.length && !s.pOut.length && !s.pIn.length && !s.wOut.length && !s.wIn.length) { warns.push({h: `The ${name} aren't part of this deal`, p: `Nothing goes to or from the ${name}. Add one of their players or remove them from the trade.`}); continue; }
    const before = payroll(ab), after = before - s.outV + s.inV;
    const outStd = s.out.filter(p => !p.twoway), incStd = s.inc.filter(p => !p.twoway);
    s.before = before; s.after = after;
    if (s.inV > s.outV) {
      if (after <= CAP) s.rule = `Stays under the ${money(CAP)} cap after the trade, so no matching needed.`;
      else if (after > APRON1) {
        s.allowed = s.outV; s.rule = "Above the 1st apron after the trade: can take back at most 100% of outgoing salary.";
        if (s.inV > s.allowed) issues.push({kind: "salary", team: ab, gap: s.inV - s.allowed, h: `The ${name} take back too much salary`,
          p: `The ${name} would be at ${money(after)} after this deal, above the ${money(APRON1)} first apron. Teams above the first apron can only take back as much salary as they send out. They send ${money(s.outV)} and receive ${money(s.inV)}, which is ${money(s.inV - s.outV)} too much. Send more salary from the ${name}, or take back less.`});
      } else {
        const o = s.outV;
        s.allowed = o <= BAND1 ? 2 * o + CUSHION : o <= BAND2 ? o + BAND_ADD : 1.25 * o + CUSHION;
        s.rule = o <= BAND1 ? `Sends ≤ ${money(BAND1)}: may take back 200% + $250K.` : o <= BAND2 ? `Sends ${money(BAND1)}–${money(BAND2)}: may take back outgoing + ${money(BAND_ADD)}.` : `Sends > ${money(BAND2)}: may take back 125% + $250K.`;
        if (s.inV > s.allowed) issues.push({kind: "salary", team: ab, gap: s.inV - s.allowed, h: `The ${name} take back too much salary`,
          p: `The ${name} are over the cap but under the first apron after this deal (${money(after)}). Sending out ${money(o)} lets them take back up to ${money(s.allowed)}, but they'd receive ${money(s.inV)}, which is ${money(s.inV - s.allowed)} over the limit. ${s.rule}${o === 0 ? " Draft picks don't count as salary, so a team over the cap has to send a contract back to take a player in." : ""} Send more salary from the ${name}, or take back less.`});
      }
    } else s.rule = s.inV === s.outV ? "Salaries match exactly." : `Takes back less salary than it sends (${money(s.outV - s.inV)} saved).`;
    if (after > APRON2 && outStd.length >= 2 && s.inV > Math.max(...outStd.map(p => p.outV))) issues.push({kind: "salary", team: ab, h: `The ${name} can't combine salaries above the 2nd apron`,
      p: `The ${name} would be at ${money(after)}, above the ${money(APRON2)} second apron. Teams there can't add players' salaries together to match an incoming contract. The biggest single salary they send is ${money(Math.max(...outStd.map(p => p.outV)))}, but they take back ${money(s.inV)}. Match with one player, or cut payroll below the second apron.`});
    if (outStd.length >= 2 && s.inV > 0) for (const p of outStd) {
      const e = elig(p, dt);
      if (e.kind === "agg") issues.push({kind: "agg", team: ab, pid: p.id, h: `${p.name} can't be packaged with other players yet`, p: e.why + " Trade him by himself, or wait.", fix: [[`Fast-forward to ${fmtD(e.until, false)}`, +e.until]]});
    }
    const std = t.roster.filter(id => !L.players[id].twoway).length, tw = t.roster.length - std;
    const std2 = std - outStd.length + incStd.length, tw2 = tw - (s.out.length - outStd.length) + (s.inc.length - incStd.length);
    s.std = [std, std2]; s.tw = [tw, tw2];
    if (std2 > 15 && std2 > std) issues.push({kind: "roster", team: ab, h: `The ${name} would have too many players`, p: `The ${name} would carry ${std2} standard contracts after this trade. The max is 15. Send ${std2 - 15} more player${std2 - 15 > 1 ? "s" : ""} out, or take fewer in.`});
    if (tw2 > 3 && tw2 > tw) issues.push({kind: "roster", team: ab, h: `The ${name} would have too many two-way players`, p: `Teams can carry at most 3 two-way players. The ${name} would have ${tw2}.`});
    if (std2 < 13 && std2 < std) issues.push({kind: "roster", team: ab, h: `The ${name} would drop below 13 players`, p: `The ${name} would have only ${std2} standard contracts. Teams can't go below 13 (and must get back to 14 within two weeks). Take a player back in the deal.`});
    else if (std2 < 14 && std2 < std) warns.push({h: `The ${name} would need to sign a player`, p: `The ${name} would be at ${std2} standard contracts. That's allowed for up to two weeks, then they need 14.`});
    if (s.inc.some(p => p.est)) warns.push({h: "Estimated salary", p: `No contract figure was found for ${s.inc.filter(p => p.est).map(p => p.name).join(", ")}, so a minimum salary of ${money(MIN_SAL)} is assumed.`});
  }
  // draft picks
  for (const id of pids) {
    const k = L.picks[id]; if (!k) continue;
    const owner = teamName(k.own), label = pickLabel(k);
    if (k.y === 2027 && dt > DRAFT) issues.push({kind: "pick", h: `The ${label} pick has already been used`, p: `The 2027 draft took place around ${fmtD(DRAFT)} (estimated). A pick can't be traded after its draft. Trade the player who was drafted instead.`});
    if (k.r === 1 && k.y === PICK_LAST && payroll(k.own) > APRON2) issues.push({kind: "pick", team: k.own, h: `The ${owner} can't trade their ${PICK_LAST} first`,
      p: `The ${owner} are above the ${money(APRON2)} second apron (${money(payroll(k.own))}). Teams above the second apron have their first-round pick seven years out (${PICK_LAST}) frozen. Trade a different pick, or get payroll under the second apron first.`});
    if (isConditional(k)) warns.push({h: `The ${label} pick depends on other results`,
      p: `What it depends on: ${pickTerms(k)} The team receiving it takes on exactly the same terms.`});
    if (sel && Object.values(wsel).length) {
      const clash = Object.keys(wsel).map(swapFromKey).find(s => s && s.isNew && s.y === k.y && s.r === k.r && (s.grantor === k.own || wsel[s.id] === k.own));
      if (clash) issues.push({kind: "swap", h: `The ${label} pick is also part of a new swap`, p: `This deal both trades the ${label} pick and creates a ${clash.y} swap involving it. A team can only offer or use a swap on a pick it keeps. Remove one of the two.`});
    }
  }
  // pick swaps
  for (const id of wids) {
    const s = swapFromKey(id), to = wsel[id]; if (!s || !L.teams[to]) continue;
    const rd = s.r === 1 ? "first" : "second";
    if (s.y === 2027 && dt > DRAFT) { issues.push({kind: "swap", h: `The ${s.y} swap is past its draft`, p: `The 2027 draft took place around ${fmtD(DRAFT)} (estimated), so a 2027 swap can't be traded or created anymore.`}); continue; }
    if (s.isNew) {
      const g = s.grantor, gp = L.picks[`${s.y}-${s.r}-${g}`], rp = L.picks[`${s.y}-${s.r}-${to}`];
      if (!gp || (psel[gp.id] || gp.own) !== g) issues.push({kind: "swap", team: g, h: `The ${teamName(g)} can't offer a ${s.y} ${rd}-round swap`,
        p: `A swap lets the other team trade picks with them later, so the ${teamName(g)} must still own their own ${s.y} ${rd}. ${gp ? `That pick belongs to the ${teamName(gp.own)}.` : ""} Pick a year where they still have their own pick.`});
      if (!rp || (psel[rp.id] || rp.own) !== to) issues.push({kind: "swap", team: to, h: `The ${teamName(to)} have no ${s.y} ${rd} to swap`,
        p: `To use a swap, the ${teamName(to)} must own their own ${s.y} ${rd}-round pick. ${rp ? `It currently belongs to the ${teamName(rp.own)}.` : ""} Choose another year or send the swap to a different team.`});
      if (s.r === 1 && s.y === PICK_LAST && payroll(g) > APRON2) issues.push({kind: "swap", team: g, h: `The ${teamName(g)} can't offer a ${PICK_LAST} first-round swap`,
        p: `The ${teamName(g)} are above the ${money(APRON2)} second apron, so their ${PICK_LAST} first (seven drafts out) is frozen. That includes giving another team swap rights on it.`});
      if (gp?.swap && L.swaps[gp.swap] && !wsel[gp.swap]) warns.push({h: `The ${s.y} ${teamName(g)} pick already has a swap`, p: `The ${teamName(L.swaps[gp.swap].holder)} already hold a swap on this pick (${pickTerms(gp)}). A new swap would only apply after that one is settled.`});
    } else if (/least|more|most|lower|higher/i.test(s.note)) {
      warns.push({h: `The ${swapLabel(s)} has conditions`, p: `What it depends on: ${pickTerms(L.picks[`${s.y}-${s.r}-${s.grantor}`])} The new holder gets exactly the same rights.`});
    }
  }
  // Stepien rule: no team may be without a first-round pick in back-to-back future drafts
  for (const ab of L.teamIds) {
    const s = summary[ab], sentYears = s.pOut.filter(k => k.r === 1).map(k => k.y);
    if (!sentYears.length) continue;
    const has = y => holdsFirst(ab, y, psel);
    for (let y = PICK_FIRST; y < PICK_LAST; y++) {
      if (!sentYears.includes(y) && !sentYears.includes(y + 1)) continue;
      if (!has(y) && !has(y + 1)) {
        issues.push({kind: "stepien", team: ab, h: `The ${L.teams[ab].short} would break the Stepien rule`,
          p: `After this deal the ${L.teams[ab].short} would have no first-round pick in either ${y} or ${y + 1}. Teams can't go without a first in back-to-back future drafts (the Stepien rule). Their own pick still counts if another team only holds a swap on it, but a pick from another team counts only if no protection or condition could keep it from coming to them. Keep one of those firsts, or get an unprotected first back for one of those years.`});
        break;
      }
    }
  }
  return {state: issues.length ? "bad" : "ok", issues, warns, summary};
}

// For each salary or roster problem, find players whose addition fixes it.
function suggest(ev) {
  const out = [];
  const teamsWithIssues = [...new Set(ev.issues.filter(i => (i.kind === "salary" || i.kind === "roster") && i.team).map(i => i.team))];
  for (const ab of teamsWithIssues) {
    const partners = L.teamIds.filter(x => x !== ab);
    const to = partners.sort((a, b) => (ev.summary[b]?.out.filter(p => L.sel[p.id] === ab).length || 0) - (ev.summary[a]?.out.filter(p => L.sel[p.id] === ab).length || 0))[0];
    if (!to) continue;
    const base = ev.issues.filter(i => i.team === ab).length;
    const cands = L.teams[ab].roster.map(id => L.players[id]).filter(p => !L.sel[p.id] && !p.twoway && elig(p).ok && elig(p).kind === "ok");
    const hits = [];
    for (const p of cands) {
      const ev2 = evaluate({...L.sel, [p.id]: to});
      const left = ev2.issues.filter(i => i.team === ab).length;
      if (left < base) hits.push({p, to, solves: ev2.state === "ok", left});
    }
    hits.sort((a, b) => (b.solves - a.solves) || (a.left - b.left) || (a.p.sal - b.p.sal));
    if (hits.length) out.push({team: ab, picks: hits.slice(0, 3)});
  }
  return out;
}

function applyTrade(tr) {
  for (const [id, to] of tr.moves) if (!L.players[id] || !L.teams[to]) return false;
  for (const [id, to] of tr.pmoves || []) if (!L.picks[id] || !L.teams[to]) return false;
  for (const [id, to] of tr.moves) {
    const p = L.players[id];
    L.teams[p.team].roster = L.teams[p.team].roster.filter(x => x !== id);
    L.teams[to].roster.push(id);
    p.team = to; p.acq = d(tr.date);
  }
  for (const [id, to] of tr.pmoves || []) { const k = L.picks[id]; k.own = to; k.also = k.also.filter(x => x !== to); k.acq = d(tr.date); }
  for (const [id, to] of tr.wmoves || []) {
    const s = swapFromKey(id); if (!s) continue;
    if (s.isNew) {
      const sid = `sw-${s.y}-${s.r}-${s.grantor}-${to}` + (L.swaps[`sw-${s.y}-${s.r}-${s.grantor}-${to}`] ? "-b" : "");
      L.swaps[sid] = {id: sid, y: s.y, r: s.r, grantor: s.grantor, holder: to, pre: false,
        note: `${L.teams[to].short} may swap their ${s.y} ${s.r === 1 ? "1st" : "2nd"}-round pick for the ${L.teams[s.grantor].short} pick (created in your trade on ${fmtD(d(tr.date))}).`};
      const k = L.picks[`${s.y}-${s.r}-${s.grantor}`]; if (k && !k.swap) { k.swap = sid; k.tags = (k.tags + " Swap Option").trim(); k.note = k.note || L.swaps[sid].note; if (!k.also.includes(to)) k.also.push(to); }
    } else if (to === L.swaps[id].grantor) {
      // a team that gets back the swap on its own pick simply cancels it
      for (const k of Object.values(L.picks)) if (k.swap === id) { k.swap = null; k.tags = k.tags.replace(/\s*Swap Option/, "").trim(); k.also = k.also.filter(x => x !== L.swaps[id].holder); }
      delete L.swaps[id];
    } else { L.swaps[id].holder = to; }
  }
  L.executed.push(tr);
  return true;
}

function search(q, limit = 12) {
  const k = norm(q); if (k.length < 2) return [];
  return Object.values(L.players).filter(p => p.key.includes(k)).sort((a, b) => (a.key.startsWith(k) ? 0 : 1) - (b.key.startsWith(k) ? 0 : 1) || b.sal - a.sal).slice(0, limit);
}

global.Engine = {L, CAP, TAX, APRON1, APRON2, BAND1, BAND2, BAND_ADD, MIN_SAL, DAY, TODAY, DEC15, JAN15, DEADLINE, REOPEN, DRAFT, END, START, SEASONS, TIER, PICK_LAST,
  d, money, fmtD, load, pickLabel, teamPicks, pickTerms, isConditional, swapLabel, swapFromKey, teamSwaps: ab => Object.values(L.swaps).filter(s => s.holder === ab && !(s.y === 2027 && L.date > DRAFT)).sort((a, b) => a.y - b.y || a.r - b.r), payroll, tierOf, windowOpen, minDate, elig, evaluate, suggest, applyTrade, search};
})(window);
