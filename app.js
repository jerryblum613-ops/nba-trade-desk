// NBA Trade Desk UI: one engine, two layouts (desktop desk and mobile app shell).
(function () {
"use strict";
const E = window.Engine, L = E.L, {money, fmtD, DAY} = E;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const store = {get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }};
const mq = window.matchMedia("(max-width: 760px)");
const U = {mode: null, force: store.get("tdesk.view"), sort: "sal", tradableOnly: false, open: {}, pkOpen: {}, q: "", mview: "roster", mteam: null, sheet: null};
let DATA = null;

// ---------- small pieces ----------
const team = ab => L.teams[ab];
const std = ab => team(ab).roster.filter(id => !L.players[id].twoway).length;
function verdict(ev) {
  if (ev.state === "idle") return ["idle", "No trade yet", "Pick players from each team to build a deal."];
  if (ev.state === "ok") return ["ok", "Trade works", `Passes every check on ${fmtD(L.date)}.`];
  return ["bad", "Trade doesn't work", `${ev.issues.length} problem${ev.issues.length > 1 ? "s" : ""} to fix. Each says why and how.`];
}
function windowText() {
  const dt = L.date;
  if (!E.windowOpen(dt)) return ["closed", `Window closed · reopens ~${fmtD(E.REOPEN, false)}`];
  if (dt <= E.DEADLINE) { const n = Math.round((E.DEADLINE - dt) / DAY); return ["open", n === 0 ? "Deadline day" : `${n} day${n > 1 ? "s" : ""} to deadline`]; }
  return ["open", "Post-Finals window open"];
}
function capMeter(before, after) {
  const lo = 100e6, max = Math.max(E.APRON2 * 1.06, before, after) * 1.01, pc = v => Math.max(0, Math.min(100, (v - lo) / (max - lo) * 100));
  const ticks = [["Cap", E.CAP], ["Tax", E.TAX], ["1st", E.APRON1], ["2nd", E.APRON2]];
  return `<div class="meter" role="img" aria-label="Payroll ${money(after)} against cap ${money(E.CAP)}"><div class="fill" style="width:${pc(before)}%"></div>${after !== before ? `<div class="fill after" style="width:${pc(after)}%"></div>` : ""}` +
    ticks.map(([l, v]) => `<div class="tick" style="left:${pc(v)}%"></div><div class="tl" style="left:${pc(v)}%">${l}</div>`).join("") + `</div>`;
}
function capBox(ab, ev) {
  const t = team(ab), s = ev.summary[ab] || {}, before = E.payroll(ab), after = before - (s.outV || 0) + (s.inV || 0), delta = after - before, n = std(ab);
  return `<div class="capbox">
    <div class="capline"><span>Payroll <span class="tier t${E.tierOf(after)}">${E.TIER[E.tierOf(after)]}</span></span>
      <span><span class="pay">${money(after)}</span>${delta ? ` <span class="delta mono ${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : "−"}${money(Math.abs(delta))}</span>` : ""}</span></div>
    ${capMeter(before, after)}
    <div class="capline rcount"><span>${n} standard · ${t.roster.length - n} two-way</span><span>${after <= E.CAP ? money(E.CAP - after) + " cap room" : after <= E.APRON1 ? money(E.APRON1 - after) + " under 1st apron" : money(after - E.APRON1) + " over 1st apron"}</span></div>
  </div>`;
}
function thead(ab, removable) {
  const t = team(ab);
  return `<div class="thead" style="background:linear-gradient(135deg, ${t.color}, color-mix(in srgb, ${t.color} 68%, #000))">
    <div class="row1"><div><div class="tloc">${esc(t.loc)} · ${esc(t.record || "0-0")}</div><div class="tname">${esc(t.short)}</div></div>
    ${removable ? `<button class="tx-x" data-rm="${ab}" aria-label="Remove ${esc(t.name)} from trade">×</button>` : ""}</div></div>`;
}
function card(p) {
  const t = team(p.team), e = E.elig(p), selTo = L.sel[p.id], st = p.st; // st: [gp, min, pts, reb, ast, fg%, 3p%, stl, blk]
  const stats = st ? `<span><i>PTS</i>${st[2].toFixed(1)}</span><span><i>REB</i>${st[3].toFixed(1)}</span><span><i>AST</i>${st[4].toFixed(1)}</span><span><i>FG</i>${st[5].toFixed(1)}%</span><span><i>3P</i>${st[6].toFixed(1)}%</span><span><i>MIN</i>${st[1].toFixed(1)}</span><span><i>GP</i>${st[0]}</span>`
    : `<span class="none">No games played this season</span>`;
  const thru = p.yrs ? E.SEASONS[Math.min(p.yrs, 6) - 1] : null;
  const oi = p.years.findIndex(y => y.opt), opt = oi >= 0 ? p.years[oi] : null;
  const optTxt = opt ? `<span class="pill info" title="${opt.opt === "P" ? "Player" : opt.opt === "T" ? "Team" : "Early termination"} option in ${E.SEASONS[oi]}">${opt.opt === "P" ? "PO" : opt.opt === "T" ? "TO" : "ETO"} ${E.SEASONS[oi].slice(2)}</span>` : "";
  const status = !e.ok ? `<span class="pill lock">🔒 ${esc(e.label)}</span>` : e.kind === "agg" ? `<span class="pill warn">${esc(e.label)}</span>` : `<span class="pill ok">Tradable</span>`;
  const sal = p.twoway ? `<span class="pill info">Two-way</span>` : `<span class="sal">${money(p.sal, 2)}${p.est ? "*" : ""}</span>`;
  const others = L.teamIds.filter(x => x !== p.team);
  const dest = selTo ? (others.length > 1 ? `<div class="dest">Sending to <select data-dest="${p.id}" aria-label="Destination for ${esc(p.name)}">${others.map(o => `<option value="${o}" ${o === selTo ? "selected" : ""}>${esc(team(o).short)}</option>`).join("")}</select></div>` : `<div class="dest">→ Sending to ${esc(team(selTo).short)}</div>`) : "";
  const open = U.open[p.id] && p.years.length;
  const years = open ? `<div class="cyears">${p.years.map((y, i) => `<div class="${y.opt ? "o" : ""}">${E.SEASONS[i]}<b>${money(y.amt, 2)}</b>${y.opt === "P" ? "Player option" : y.opt === "T" ? "Team option" : y.opt === "E" ? "ETO" : "Guaranteed"}</div>`).join("")}${p.sig ? `<div class="src">Last move: ${esc(p.sig.text)} (${fmtD(p.sig.date)})</div>` : ""}</div>` : "";
  return `<div class="pcard ${selTo ? "sel" : ""} ${e.ok ? "" : "dim"}" role="button" tabindex="0" aria-pressed="${!!selTo}" data-pid="${p.id}">
    <div class="num" style="background:${t.color}">${esc(p.jersey ?? "")}</div>
    <div class="pname"><span class="nm">${esc(p.name)}</span>${p.inj ? `<span class="pill inj">${esc(p.inj)}</span>` : ""}<span class="chk" aria-hidden="true">✓</span></div>
    <div class="pmeta"><b>${esc(p.pos)}</b> · <b>${esc(p.ht)}</b> · ${esc(p.wt)} · Age ${p.age ?? "—"} · ${p.exp ? p.exp + " yrs exp" : "Rookie"}</div>
    <div class="pstats">${stats}</div>
    <div class="pcon">${sal}${!p.twoway && p.yrs ? `<span class="yrs">${p.yrs} yr${p.yrs > 1 ? "s" : ""} · thru ${thru}</span>` : ""}${optTxt}${status}${p.years.length ? `<button class="more" data-open="${p.id}" aria-expanded="${!!open}">${open ? "Hide" : "Contract"} ${open ? "▴" : "▾"}</button>` : ""}</div>
    ${years}
    ${selTo && !e.ok ? `<div class="whylock">${esc(e.why)}</div>` : ""}
    ${dest}
  </div>`;
}
function picksSection(ab) {
  const picks = E.teamPicks(ab), selN = picks.filter(k => L.psel[k.id]).length, open = U.pkOpen[ab] ?? false;
  const firsts = picks.filter(k => k.r === 1).length, others = L.teamIds.filter(x => x !== ab);
  const row = k => {
    const to = L.psel[k.id], tag = k.also.length || /Protected|Conditional|Swap/.test(k.tags) ? (/Protected/.test(k.tags) ? "Protected" : /Swap/.test(k.tags) ? "Swap" : "Conditional") : "";
    const frozen = k.r === 1 && k.y === E.PICK_LAST && E.payroll(ab) > E.APRON2;
    return `<div class="pk ${to ? "sel" : ""}" role="button" tabindex="0" aria-pressed="${!!to}" data-pick="${k.id}" title="${esc(k.note || "")}">
      <span class="py">${k.y}</span><span class="pr ${k.r === 1 ? "r1" : ""}">${k.r === 1 ? "1st" : "2nd"}</span>
      <span class="po">${k.orig === ab ? "Own" : "via " + esc(team(k.orig)?.short || k.orig)}</span>
      ${tag ? `<span class="pill warn">${tag}</span>` : ""}${frozen ? `<span class="pill lock">Frozen</span>` : ""}
      ${to ? (others.length > 1 ? `<select data-pdest="${k.id}" aria-label="Destination for ${k.y} pick">${others.map(o => `<option value="${o}" ${o === to ? "selected" : ""}>→ ${esc(team(o).short)}</option>`).join("")}</select>` : `<span class="pto">→ ${esc(team(to).short)}</span>`) : `<span class="chk" aria-hidden="true">✓</span>`}
    </div>`;
  };
  return `<div class="pks"><button class="pkhead" data-pkopen="${ab}" aria-expanded="${open}"><span><b>Draft picks</b> · ${firsts} first${firsts === 1 ? "" : "s"}, ${picks.length - firsts} second${picks.length - firsts === 1 ? "" : "s"}</span>${selN ? `<span class="pill info" style="color:var(--sel)">${selN} in deal</span>` : ""}<span class="car">${open ? "▴" : "▾"}</span></button>
    ${open ? `<div class="pklist">${picks.length ? picks.map(row).join("") : `<div class="sub" style="padding:6px 4px">No picks left to trade.</div>`}</div>` : picks.filter(k => L.psel[k.id]).length ? `<div class="pklist">${picks.filter(k => L.psel[k.id]).map(row).join("")}</div>` : ""}</div>`;
}
function teamGrid(title, sub) {
  return `<div class="pickteams"><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ""}<div class="tgrid">${L.order.filter(ab => !L.teamIds.includes(ab)).map(ab => `<button data-team="${ab}"><span class="dot" style="background:${team(ab).color}"></span><span class="n">${esc(team(ab).name)}</span></button>`).join("")}</div></div>`;
}
function rosterIds(ab) {
  const f = {sal: p => -(p.twoway ? -1 : p.sal), pts: p => -(p.st?.[2] ?? -1), age: p => p.age ?? 99, name: p => p.name};
  let arr = team(ab).roster.map(id => L.players[id]);
  if (U.tradableOnly) arr = arr.filter(p => E.elig(p).ok || L.sel[p.id]);
  return arr.sort((a, b) => { const x = f[U.sort](a), y = f[U.sort](b); return x < y ? -1 : x > y ? 1 : 0; });
}
const sortbar = () => `<div class="sortbar">Sort ${[["sal", "Salary"], ["pts", "Points"], ["age", "Age"], ["name", "Name"]].map(([k, l]) => `<button data-sort="${k}" class="${U.sort === k ? "on" : ""}">${l}</button>`).join("")}
  <label><input type="checkbox" id="tradOnly" ${U.tradableOnly ? "checked" : ""}> Tradable now</label></div>`;
function issuesHtml(ev) {
  const sugg = E.suggest(ev);
  const one = (x, warn) => {
    const s = !warn && x.team ? sugg.find(g => g.team === x.team) : null;
    const fixes = (x.fix || []).map(([l, ms]) => `<button data-go="${ms}">${esc(l)} ⏩</button>`).join("");
    const adds = s ? `<span class="lbl">Try adding:</span>` + s.picks.map(h => `<button class="add" data-addp="${h.p.id}" data-to="${h.to}">+ ${esc(h.p.name)} ${money(h.p.sal)}${h.solves ? " ✓" : ""}</button>`).join("") : "";
    if (s) sugg.splice(sugg.indexOf(s), 1);
    return `<div class="issue ${warn ? "warn" : ""}"><span class="ic" aria-hidden="true">${warn ? "!" : "×"}</span><div><h4>${esc(x.h)}</h4><p>${esc(x.p)}</p>${fixes || adds ? `<div class="fix">${fixes}${adds}</div>` : ""}</div></div>`;
  };
  return ev.issues.length || ev.warns.length ? `<div class="issues">${ev.issues.map(x => one(x)).join("")}${ev.warns.map(x => one(x, true)).join("")}</div>` : "";
}
function summaryHtml(ev) {
  if (ev.state === "idle") return `<div class="empty"><h4>How to build a trade</h4><ol><li>Pick 2 to 4 teams.</li><li>Tap players or draft picks to send them. With 3+ teams, choose where each one goes.</li><li>Read the verdict. If it fails, each problem says why, with a fix.</li><li>Use the date controls to fast-forward until locked players become eligible.</li></ol></div>`;
  return L.teamIds.map(ab => {
    const s = ev.summary[ab], t = team(ab); if (!s) return "";
    const li = (arr, pk) => arr.length || pk.length ? arr.map(p => `<div><span>${esc(p.name)}</span><span class="mono">${p.twoway ? "two-way" : money(p.sal)}</span></div>`).join("") +
      pk.map(k => `<div><span>${esc(E.pickLabel(k))} pick</span><span class="mono" style="color:var(--mute)">${/Protected|Conditional|Swap/.test(k.tags) || k.also.length ? "cond." : "pick"}</span></div>`).join("") : `<div><span style="color:var(--faint)">Nothing</span></div>`;
    const bad = ev.issues.some(i => i.kind === "salary" && i.team === ab);
    return `<div class="tsum"><h3><span class="dot" style="background:${t.color}"></span>${esc(t.short)}</h3>
      <div class="lst"><div class="k">Receive</div>${li(s.inc, s.pIn)}<div class="k">Send</div>${li(s.out, s.pOut)}</div>
      <div class="mrow"><span>Outgoing salary</span><span class="mono">${money(s.outV)}</span></div>
      <div class="mrow"><span>Incoming salary</span><span class="mono">${money(s.inV)}</span></div>
      ${s.allowed != null ? `<div class="mrow"><span>Max allowed in</span><span class="mono">${money(s.allowed)}</span></div>` : ""}
      ${s.before != null ? `<div class="mrow res"><span>Payroll</span><span class="mono">${money(s.before)} → ${money(s.after)}</span></div>
      <div class="mrow"><span>Roster</span><span class="mono">${s.std[0]} → ${s.std[1]} standard</span></div>` : ""}
      ${s.rule ? `<div class="${bad ? "badline" : "okline"}">${bad ? "✕" : "✓"} ${esc(s.rule)}</div>` : ""}</div>`;
  }).join("");
}
const historyHtml = () => L.executed.length ? `<div class="history"><b style="color:var(--ink)">Trades you've made</b><ol>${L.executed.map(tr => `<li>${fmtD(E.d(tr.date))}: ${esc(tr.label)}</li>`).join("")}</ol><button class="btn ghost danger" id="resetLeague" style="margin-top:8px">Undo all trades</button></div>` : "";
function timeMarks() {
  const S = E.START, span = E.END - S;
  return [["Dec 15", E.DEC15, ""], ["Jan 15", E.JAN15, "sm-hide"], ["Deadline", E.DEADLINE, "dl"], ["Finals end", E.REOPEN, ""]].filter(m => m[1] >= S)
    .map(([l, dt, c]) => { const f = (dt - S) / span; return `<span class="mark ${c}" style="left:calc(${f * 100}% + ${8 - 16 * f}px)">${l}</span>`; }).join("");
}
const timeChips = () => [["+1 week", 7], ["+1 month", 30]].map(([l, n]) => `<button class="chip ff" data-addd="${n}">${l} ⏩</button>`).join("") +
  [["Today", E.TODAY], ["Dec 15", E.DEC15], ["Jan 15", E.JAN15], ["Deadline", E.DEADLINE], ["After Finals", E.REOPEN]].filter(j => j[1] >= E.START).map(([l, dt]) => `<button class="chip" data-go="${+dt}">${l}</button>`).join("");
const slider = () => `<div class="track"><input type="range" id="slider" min="${Math.round((E.minDate() - E.START) / DAY)}" max="${Math.round((E.END - E.START) / DAY)}" value="${Math.round((L.date - E.START) / DAY)}" aria-label="League date"><div class="marks">${timeMarks()}</div></div>`;
const bigDate = () => L.date.toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric", year: "numeric"});
function searchList(compact) {
  const res = E.search(U.q, compact ? 8 : 20);
  if (!U.q) return "";
  if (!res.length) return `<div class="sub" style="padding:8px">No player matches “${esc(U.q)}”.</div>`;
  return `<div class="sres">${res.map(p => { const e = E.elig(p); return `<button data-find="${p.id}" class="${L.sel[p.id] ? "on" : ""}"><span class="dot" style="background:${team(p.team).color}"></span><span style="min-width:0"><div class="n">${esc(p.name)}</div><div class="m">${esc(team(p.team).short)} · ${esc(p.pos)} · ${esc(p.ht)}${e.ok ? "" : " · 🔒 " + esc(e.label)}</div></span><span class="s">${p.twoway ? "2-way" : money(p.sal)}</span></button>`; }).join("")}</div>`;
}
const footHtml = () => `<p><b>Checks:</b> salary matching by payroll tier (under cap, over cap, 1st apron 100% rule, 2nd apron no-aggregation), roster limits (15 standard, 3 two-way, 13 minimum), freezes on newly signed and extended players, the 2-month aggregation freeze after a trade, 10-day contracts, and the trade deadline.</p>
  <p><b>2026-27:</b> cap ${money(E.CAP, 3)} · tax ${money(E.TAX, 3)} · 1st apron ${money(E.APRON1, 3)} · 2nd apron ${money(E.APRON2, 3)}. Matching bands, the Feb 4 deadline and the Finals end date are estimates. Payroll leaves out dead money from waived players. <b>Picks:</b> 2027–${E.PICK_LAST} firsts and seconds; checks the Stepien rule (no back-to-back years without a first), the frozen ${E.PICK_LAST} first for second-apron teams, and the draft date. Protected, conditional and swap picks keep their terms. Not modelled yet: trading swap rights on their own, cash, trade exceptions, exception hard caps. * = salary not found, minimum assumed.</p>
  <p>Data: rosters, heights, stats and transactions from ESPN; contracts from Basketball-Reference; pick ownership from Salary Swish. Updated ${DATA ? new Date(DATA.updated).toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : ""}. <button class="btn ghost" data-view="${U.mode === "mobile" ? "desktop" : "mobile"}" style="padding:2px 8px;font-size:12px">Switch to ${U.mode === "mobile" ? "desktop" : "mobile"} layout</button></p>`;

// ---------- DESKTOP ----------
function desktopShell() {
  $("app").innerHTML = `<header class="d-top" id="dTop"></header><main class="d-main"><aside class="d-side" id="dSide"></aside><section class="d-board" id="dBoard" aria-label="Teams in the trade"></section><aside class="d-panel" id="dPanel" aria-live="polite"></aside></main><footer class="d-foot" id="dFoot"></footer>`;
}
function dTop(keepSlider) {
  const [wc, wt] = windowText();
  if (keepSlider && $("dDate")) { $("dDate").textContent = bigDate(); $("dStat").className = "tm-status " + wc; $("dStat").textContent = wt; return; }
  $("dTop").innerHTML = `<div><div class="brand">Trade <span>Desk</span></div><div class="sub">${esc(DATA.season)} NBA season</div></div>
    <div class="tmd"><span class="tm-label">League date</span><span class="tm-big" id="dDate">${bigDate()}</span><span class="tm-status ${wc}" id="dStat">${wt}</span></div>
    <div class="tmr">${slider()}<div class="chips">${timeChips()}</div></div>
    <div class="meta sub">Rosters updated<br><b>${new Date(DATA.updated).toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"})}</b></div>`;
}
function dSide() {
  const focused = document.activeElement?.id === "dq";
  $("dSide").innerHTML = `<h2>Find any player</h2><div class="sbox"><input id="dq" type="search" placeholder="Search 500+ players" value="${esc(U.q)}" autocomplete="off"></div><div id="dRes">${searchList(true)}</div>
    <h2>Teams in this trade (${L.teamIds.length}/4)</h2><div class="tlist">${L.order.map(ab => { const t = team(ab), on = L.teamIds.includes(ab), pay = E.payroll(ab);
      return `<button data-team="${ab}" class="${on ? "in" : ""}" ${!on && L.teamIds.length >= 4 ? "disabled" : ""} aria-pressed="${on}"><span class="box">✓</span><span class="dot" style="background:${t.color}"></span><span class="nm">${esc(t.name)}</span><span class="tier t${E.tierOf(pay)}" title="${money(pay)}">${E.TIER[E.tierOf(pay)].replace("Under cap", "Room").replace("Over cap", "Over")}</span></button>`; }).join("")}</div>`;
  if (focused) { const i = $("dq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
function dBoard(ev) {
  const n = L.teamIds.length;
  $("dBoard").style.gridAutoColumns = `minmax(${n > 3 ? 290 : 300}px,1fr)`;
  $("dBoard").innerHTML = L.teamIds.map(ab => `<article class="col">${thead(ab, true)}${capBox(ab, ev)}${picksSection(ab)}${sortbar()}<div class="roster">${rosterIds(ab).map(card).join("")}</div></article>`).join("") +
    (n === 0 ? `<article class="col startcol">${teamGrid("Start a trade", "Choose the teams you want to trade between. You can also search for any player on the left.")}</article>`
      : n === 1 ? `<article class="col startcol">${teamGrid("Add a team to trade with", `Pick a partner for the ${esc(team(L.teamIds[0]).short)}. Trades can include up to 4 teams.`)}</article>` : "");
}
function dPanel(ev) {
  const [c, h, s] = verdict(ev);
  $("dPanel").innerHTML = `<div class="vhead"><div><div class="vtitle ${c}">${h}${c === "ok" ? " ✓" : ""}</div><div class="vsub">${s}</div></div></div>
    ${issuesHtml(ev)}
    <div class="actions"><button class="btn ${ev.state === "ok" ? "go" : "primary"}" data-exec ${ev.state === "ok" ? "" : "disabled"}>Make this trade</button><button class="btn" id="clearSel" ${ev.state === "idle" ? "disabled" : ""}>Clear</button></div>
    ${summaryHtml(ev)}${historyHtml()}`;
}
function renderDesktop(keepSlider) {
  const ev = E.evaluate();
  dTop(keepSlider); if (!keepSlider) dSide(); dBoard(ev); dPanel(ev); $("dFoot").innerHTML = footHtml();
}

// ---------- MOBILE ----------
const ICON = {
  roster: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c2.3.2 4 1.8 4.8 4.8"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`,
  trade: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></svg>`};
function mobileShell() {
  $("app").innerHTML = `<div class="m-shell"><header class="m-bar" id="mBar"></header><nav class="m-teams" id="mTeams" aria-label="Teams in trade"></nav><main class="m-body" id="mBody" aria-live="polite"></main></div><div class="m-dock" id="mDock"></div><div id="mSheet"></div>`;
}
function mBar() {
  const [wc, wt] = windowText();
  $("mBar").innerHTML = `<div class="r1"><div class="brand">Trade <span>Desk</span></div><button class="datepill" data-sheet="time" aria-label="Change league date"><b>${L.date.toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"})} ⏩</b><span class="${wc}">${wt}</span></button></div>`;
}
function mTeams() {
  if (!L.teamIds.includes(U.mteam)) U.mteam = L.teamIds[0];
  $("mTeams").innerHTML = L.teamIds.map(ab => { const t = team(ab), n = Object.keys(L.sel).filter(id => L.players[id].team === ab).length + Object.keys(L.psel).filter(id => L.picks[id].own === ab).length, on = U.mview === "roster" && ab === U.mteam;
    return `<button class="tchip ${on ? "on" : ""}" data-mteam="${ab}" style="${on ? `background:${t.color}` : ""}"><span class="dot" style="background:${on ? "#fff" : t.color}"></span>${esc(t.short)}${n ? `<span class="ct">${n}</span>` : ""}</button>`; }).join("") +
    `<button class="tchip add" data-sheet="teams">+ Teams</button>`;
}
function mBody(ev) {
  const b = $("mBody");
  if (U.mview === "roster") {
    const ab = U.mteam;
    if (!ab) { b.innerHTML = `<div class="m-section">${teamGrid("Start a trade", "Pick the teams you want to trade between. You can also find any player in Search.")}</div>`; return; }
    b.innerHTML = `<div class="m-thead">${thead(ab, false)}${capBox(ab, ev)}${picksSection(ab)}</div>${L.teamIds.length < 2 ? `<div class="m-section" style="margin-top:12px">${teamGrid("Add a team to trade with", "")}</div>` : ""}${sortbar()}<div class="roster">${rosterIds(ab).map(card).join("")}</div>`;
  } else if (U.mview === "search") {
    b.innerHTML = `<div class="m-section"><h2>Find any player</h2><div class="sbox"><input id="mq" type="search" placeholder="Name, e.g. Tatum" value="${esc(U.q)}" autocomplete="off" enterkeyhint="search"></div><div id="mRes">${searchList(false)}</div>${U.q ? "" : `<p class="sub" style="margin:10px 2px 0">Tap a result to add him to the trade. His team joins the deal if it isn't in it yet.</p>`}</div>`;
  } else {
    const [c, h, s] = verdict(ev);
    b.innerHTML = `<div class="m-section"><div class="vtitle ${c}">${h}${c === "ok" ? " ✓" : ""}</div><div class="vsub">${s}</div>
      ${ev.issues.length || ev.warns.length ? `<div style="margin-top:12px">${issuesHtml(ev)}</div>` : ""}
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn ${ev.state === "ok" ? "go" : "primary"}" data-exec style="flex:1;padding:11px" ${ev.state === "ok" ? "" : "disabled"}>Make this trade</button><button class="btn" id="clearSel" style="padding:11px" ${ev.state === "idle" ? "disabled" : ""}>Clear</button></div></div>
      <div class="m-section">${summaryHtml(ev)}${historyHtml()}</div>
      <div class="sub" style="padding:4px 2px 12px">${footHtml()}</div>`;
  }
}
function mDock(ev) {
  const [c, h] = verdict(ev), n = Object.keys(L.sel).length + Object.keys(L.psel).length;
  const detail = ev.state === "bad" ? ev.issues[0].h : ev.state === "ok" ? `${n} asset${n > 1 ? "s" : ""} move` : L.teamIds.length < 2 ? "Pick at least 2 teams" : "Tap players or picks to add them";
  $("mDock").innerHTML = (U.mview !== "trade" ? `<button class="m-verdict" data-mview="trade"><span class="vt ${c}">${h}</span><span class="vd">${esc(detail)}</span>${ev.state === "ok" ? `<span class="btn go" data-exec>Make trade</span>` : ""}</button>` : "") +
    `<div class="m-tabs" role="tablist">${[["roster", "Rosters"], ["search", "Search"], ["trade", "Trade"]].map(([k, l]) => `<button role="tab" aria-selected="${U.mview === k}" class="${U.mview === k ? "on" : ""}" data-mview="${k}">${ICON[k]}${l}${k === "trade" && n ? `<span class="badge ${ev.state}">${n}</span>` : ""}</button>`).join("")}</div>`;
}
function mSheet() {
  const el = $("mSheet");
  if (!U.sheet) { el.innerHTML = ""; return; }
  if (U.sheet === "time") {
    const [wc, wt] = windowText();
    el.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet" role="dialog" aria-label="League date"><div class="grab"></div>
      <span class="tm-label">League date</span><div class="tm-big" id="mDate">${bigDate()}</div><div class="tm-status ${wc}" id="mStat">${wt}</div>
      <div style="margin-top:14px">${slider()}</div><div class="chips">${timeChips()}</div>
      <p class="sub" style="margin:14px 0 0">Move the date forward to see when signed and extended players become tradable. Trades you make lock the calendar so it can't go back before them.</p>
      <button class="btn primary" data-close style="width:100%;margin-top:14px;padding:11px">Done</button></div>`;
  } else {
    el.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet" role="dialog" aria-label="Choose teams"><div class="grab"></div>
      <h3>Teams in the trade (${L.teamIds.length}/4)</h3><div class="tgrid">${L.order.map(ab => { const t = team(ab), on = L.teamIds.includes(ab);
        return `<button data-team="${ab}" class="${on ? "in" : ""}" ${!on && L.teamIds.length >= 4 ? "disabled" : ""} aria-pressed="${on}"><span class="dot" style="background:${t.color}"></span><span class="n">${esc(t.short)}</span>${on ? `<span style="margin-left:auto;color:var(--sel)">✓</span>` : ""}</button>`; }).join("")}</div>
      <p class="sub" style="margin:10px 0 0">Pick 2 to 4 teams. Tap a checked team to remove it.</p>
      <button class="btn primary" data-close style="width:100%;margin-top:12px;padding:11px">Done</button></div>`;
  }
}
function renderMobile(keepSlider) {
  const ev = E.evaluate();
  mBar(); mTeams(); mBody(ev); mDock(ev);
  if (keepSlider && $("mDate")) { const [wc, wt] = windowText(); $("mDate").textContent = bigDate(); $("mStat").className = "tm-status " + wc; $("mStat").textContent = wt; }
  else mSheet();
}

// ---------- shared render + actions ----------
function render(keepSlider) {
  const mode = U.force || (mq.matches ? "mobile" : "desktop");
  if (mode !== U.mode) { U.mode = mode; mode === "mobile" ? mobileShell() : desktopShell(); keepSlider = false; }
  mode === "mobile" ? renderMobile(keepSlider) : renderDesktop(keepSlider);
}
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function setDate(ms, keepSlider) {
  let dt = new Date(ms); dt.setHours(12, 0, 0, 0);
  const lo = E.minDate(); if (dt < lo) dt = new Date(lo); if (dt > E.END) dt = new Date(E.END);
  L.date = dt; render(keepSlider);
}
function toggleTeam(ab) {
  if (L.teamIds.includes(ab)) {
    L.teamIds = L.teamIds.filter(x => x !== ab);
    for (const [id, to] of Object.entries(L.sel)) if (to === ab || L.players[id].team === ab) delete L.sel[id];
    for (const [id, to] of Object.entries(L.psel)) if (to === ab || L.picks[id].own === ab) delete L.psel[id];
    for (const [id, to] of Object.entries(L.sel)) if (!L.teamIds.includes(to)) L.sel[id] = L.teamIds.find(x => x !== L.players[id].team);
    if (U.mteam === ab) U.mteam = L.teamIds[0];
  } else {
    if (L.teamIds.length >= 4) return toast("Trades can include up to 4 teams. Remove one first.");
    L.teamIds.push(ab); U.mteam = ab;
    if (U.sheet === null && U.mode === "mobile" && L.teamIds.length < 2) toast(`Added the ${team(ab).short}. Now pick a team to trade with.`);
  }
  render();
}
function addTeamFor(ab, what) {
  if (L.teamIds.includes(ab)) return true;
  if (L.teamIds.length >= 4) { toast(`Trades can include up to 4 teams. Remove one to add ${what}.`); return false; }
  L.teamIds.push(ab); return true;
}
function togglePlayer(id, to) {
  const p = L.players[id];
  if (L.sel[id] && !to) delete L.sel[id];
  else {
    if (!addTeamFor(p.team, p.name)) return;
    const dest = to && L.teamIds.includes(to) ? to : L.teamIds.find(x => x !== p.team);
    if (!dest) { U.mteam = p.team; toast(`Added the ${team(p.team).short}. Pick a second team to send ${p.name} to.`); return render(); }
    L.sel[id] = dest;
  }
  render();
}
function togglePick(id) {
  const k = L.picks[id];
  if (L.psel[id]) delete L.psel[id];
  else {
    const dest = L.teamIds.find(x => x !== k.own);
    if (!dest) return toast(`Pick a second team to send the ${E.pickLabel(k)} pick to.`);
    L.psel[id] = dest;
  }
  render();
}
function execute() {
  const ev = E.evaluate(); if (ev.state !== "ok") return;
  const label = L.teamIds.map(ab => { const s = ev.summary[ab]; const got = [...s.inc.map(p => p.name), ...s.pIn.map(k => E.pickLabel(k) + " pick")]; return got.length ? `${team(ab).short} get ${got.join(", ")}` : null; }).filter(Boolean).join("; ");
  E.applyTrade({date: L.date.toISOString().slice(0, 10), moves: Object.entries(L.sel), pmoves: Object.entries(L.psel), label});
  L.sel = {}; L.psel = {}; store.set("tdesk.trades", L.executed); render(); toast("Trade made. Rosters and picks updated.");
}

document.addEventListener("click", e => {
  const el = e.target.closest("[data-pid],[data-pick],[data-pkopen],[data-go],[data-addd],[data-rm],[data-sort],[data-exec],[data-team],[data-open],[data-find],[data-addp],[data-mteam],[data-mview],[data-sheet],[data-close],[data-view],#clearSel,#resetLeague,select,input");
  if (!el || el.matches("select,input")) return;
  if (el.dataset.open) { e.stopPropagation(); U.open[el.dataset.open] = !U.open[el.dataset.open]; return render(); }
  if (el.dataset.exec !== undefined) { e.stopPropagation(); return execute(); }
  if (el.dataset.pid) return togglePlayer(el.dataset.pid);
  if (el.dataset.pick) return togglePick(el.dataset.pick);
  if (el.dataset.pkopen) { const ab = el.dataset.pkopen; U.pkOpen[ab] = !(U.pkOpen[ab] ?? false); return render(); }
  if (el.dataset.go) return setDate(+el.dataset.go);
  if (el.dataset.addd) return setDate(+L.date + el.dataset.addd * DAY);
  if (el.dataset.rm || el.dataset.team) return toggleTeam(el.dataset.rm || el.dataset.team);
  if (el.dataset.sort) { U.sort = el.dataset.sort; return render(); }
  if (el.dataset.find) { const p = L.players[el.dataset.find]; togglePlayer(p.id); if (U.mode === "mobile" && L.sel[p.id]) toast(`${p.name} added to the trade`); return; }
  if (el.dataset.addp) return togglePlayer(el.dataset.addp, el.dataset.to);
  if (el.dataset.mteam) { U.mteam = el.dataset.mteam; U.mview = "roster"; render(); return scrollTo({top: 0}); }
  if (el.dataset.mview) { U.mview = el.dataset.mview; render(); scrollTo({top: 0}); if (U.mview === "search") $("mq")?.focus(); return; }
  if (el.dataset.sheet) { U.sheet = el.dataset.sheet; return render(); }
  if (el.dataset.close !== undefined) { U.sheet = null; return render(); }
  if (el.dataset.view) { U.force = el.dataset.view; store.set("tdesk.view", U.force); return render(); }
  if (el.id === "clearSel") { L.sel = {}; L.psel = {}; return render(); }
  if (el.id === "resetLeague") { store.set("tdesk.trades", []); const keep = L.teamIds; E.load(DATA, []); L.date = E.START; L.teamIds = keep; return render(); }
});
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.dataset?.pid) { e.preventDefault(); togglePlayer(e.target.dataset.pid); }
  if ((e.key === "Enter" || e.key === " ") && e.target.dataset?.pick) { e.preventDefault(); togglePick(e.target.dataset.pick); }
  if (e.key === "Escape" && U.sheet) { U.sheet = null; render(); }
});
document.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.dest) { L.sel[el.dataset.dest] = el.value; render(); }
  if (el.dataset.pdest) { L.psel[el.dataset.pdest] = el.value; render(); }
  if (el.id === "tradOnly") { U.tradableOnly = el.checked; render(); }
});
document.addEventListener("input", e => {
  const el = e.target;
  if (el.id === "slider") setDate(+E.START + el.value * DAY, true);
  if (el.id === "dq" || el.id === "mq") { U.q = el.value; const box = $(el.id === "dq" ? "dRes" : "mRes"); if (box) box.innerHTML = searchList(el.id === "dq"); }
});
mq.addEventListener?.("change", () => { if (!U.force) render(); });

// ---------- boot: start with no teams picked ----------
fetch("data.json", {cache: "no-cache"}).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(data => {
  DATA = data;
  E.load(data, store.get("tdesk.trades") || []);
  L.teamIds = [];
  U.mteam = null;
  render();
}).catch(err => { $("app").innerHTML = `<div class="loading">Couldn't load roster data (${esc(err.message)}). Reload the page to try again.</div>`; });
})();
