// NBA Trade Desk UI: one engine, two layouts (desktop desk and mobile app shell).
(function () {
"use strict";
const E = window.Engine, L = E.L, {money, fmtD, DAY} = E;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const store = {get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }};
const mq = window.matchMedia("(max-width: 760px)");
const U = {mode: null, force: store.get("tdesk.view"), sort: "sal", tradableOnly: false, open: {}, pkOpen: {}, ctOpen: {}, q: "", mview: "roster", mteam: null, sheet: null};
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
    <div class="capline rcount"><span>${n} standard · ${t.roster.length - n} two-way${t.dead ? ` · ${money(t.dead)} dead` : ""}</span><span>${after <= E.CAP ? money(E.CAP - after) + " cap room" : after <= E.APRON1 ? money(E.APRON1 - after) + " under 1st apron" : money(after - E.APRON1) + " over 1st apron"}</span></div>
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
  const terms = p.terms || [];
  const termTxt = (p.ntc ? `<span class="pill lock" title="${p.ntc === "clause" ? "No-trade clause: he must approve any trade" : "Re-signed for one season with Bird rights: he can veto trades until the season ends"}">${p.ntc === "clause" ? "No-trade clause" : "Can veto trades"}</span>` : "")
    + (terms.includes("Rookie Scale Contract") ? `<span class="pill info">Rookie scale</span>` : "")
    + (terms.includes("Maximum Contract") ? `<span class="pill info">Max</span>` : "");
  const others = L.teamIds.filter(x => x !== p.team);
  const dest = selTo ? (others.length > 1 ? `<div class="dest">Sending to <select data-dest="${p.id}" aria-label="Destination for ${esc(p.name)}">${others.map(o => `<option value="${o}" ${o === selTo ? "selected" : ""}>${esc(team(o).short)}</option>`).join("")}</select></div>` : `<div class="dest">→ Sending to ${esc(team(selTo).short)}</div>`) : "";
  const open = U.open[p.id] && p.years.length;
  const years = open ? `<div class="cyears">${p.years.map((y, i) => `<div class="${y.opt ? "o" : ""}">${E.SEASONS[i]}<b>${money(y.amt, 2)}</b>${y.opt === "P" ? "Player option" : y.opt === "T" ? "Team option" : y.opt === "E" ? "ETO" : "Guaranteed"}</div>`).join("")}${p.sig ? `<div class="src">Last move: ${esc(p.sig.text)} (${fmtD(p.sig.date)})</div>` : ""}</div>` : "";
  return `<div class="pcard ${selTo ? "sel" : ""} ${e.ok ? "" : "dim"}" role="button" tabindex="0" aria-pressed="${!!selTo}" data-pid="${p.id}">
    <div class="num" style="background:${t.color}">${esc(p.jersey ?? "")}</div>
    <div class="pname"><span class="nm">${esc(p.name)}</span>${p.inj ? `<span class="pill inj">${esc(p.inj)}</span>` : ""}<span class="chk" aria-hidden="true">✓</span></div>
    <div class="pmeta"><b>${esc(p.pos)}</b> · <b>${esc(p.ht)}</b> · ${esc(p.wt)} · Age ${p.age ?? "—"} · ${p.exp ? p.exp + " yrs exp" : "Rookie"}</div>
    <div class="pstats">${stats}</div>
    <div class="pcon">${sal}${!p.twoway && p.yrs ? `<span class="yrs">${p.yrs} yr${p.yrs > 1 ? "s" : ""} · thru ${thru}</span>` : ""}${optTxt}${termTxt}${status}${p.years.length ? `<button class="more" data-open="${p.id}" aria-expanded="${!!open}">${open ? "Hide" : "Contract"} ${open ? "▴" : "▾"}</button>` : ""}</div>
    ${years}
    ${selTo && !e.ok ? `<div class="whylock">${esc(e.why)}</div>` : ""}
    ${dest}
  </div>`;
}
function picksSection(ab) {
  const picks = E.teamPicks(ab), swaps = E.teamSwaps(ab), open = U.pkOpen[ab] ?? false;
  const firsts = picks.filter(k => k.r === 1).length, others = L.teamIds.filter(x => x !== ab);
  const destSel = (attr, id, to, what) => others.length > 1
    ? `<select ${attr}="${id}" aria-label="Destination for ${what}">${others.map(o => `<option value="${o}" ${o === to ? "selected" : ""}>→ ${esc(team(o).short)}</option>`).join("")}</select>`
    : `<span class="pto">→ ${esc(team(to).short)}</span>`;
  const newKey = k => `new-${k.y}-${k.r}-${ab}`;
  const row = k => {
    const to = L.psel[k.id], sw = L.wsel[newKey(k)], cond = E.isConditional(k);
    const tag = cond ? (/Protected/.test(k.tags) ? "Protected" : /Swap/.test(k.tags) ? "Swap attached" : "Conditional") : "";
    const frozen = k.r === 1 && k.y === E.PICK_LAST && E.payroll(ab) > E.APRON2;
    const canSwap = k.orig === ab && others.length && !to;
    return `<div class="pkw"><div class="pk ${to ? "sel" : ""}" role="button" tabindex="0" aria-pressed="${!!to}" data-pick="${k.id}">
      <span class="py">${k.y}</span><span class="pr ${k.r === 1 ? "r1" : ""}">${k.r === 1 ? "1st" : "2nd"}</span>
      <span class="po">${k.orig === ab ? "Own" : "via " + esc(team(k.orig)?.short || k.orig)}</span>
      ${tag ? `<span class="pill warn">${tag}</span>` : ""}${frozen ? `<span class="pill lock">Frozen</span>` : ""}
      ${to ? destSel("data-pdest", k.id, to, `${k.y} pick`) : `<span class="chk" aria-hidden="true">✓</span>`}
    </div>
    ${cond ? `<div class="pnote"><b>How it works:</b> ${esc(E.pickTerms(k))}</div>` : ""}
    ${sw ? `<div class="pk swnew sel" data-newswap="${newKey(k)}" role="button" tabindex="0" aria-pressed="true"><span class="pr sw">Swap</span><span class="po">Swap rights on this pick</span>${destSel("data-wdest", newKey(k), sw, `${k.y} swap`)}</div>`
      : canSwap ? `<button class="swbtn" data-newswap="${newKey(k)}">+ Offer a swap on this pick</button>` : ""}</div>`;
  };
  const srow = s => {
    const to = L.wsel[s.id];
    return `<div class="pkw"><div class="pk ${to ? "sel" : ""}" role="button" tabindex="0" aria-pressed="${!!to}" data-swap="${s.id}">
      <span class="py">${s.y}</span><span class="pr sw">Swap</span><span class="po">Right to swap with the ${esc(team(s.grantor)?.short || s.grantor)}</span>
      ${to ? destSel("data-wdest", s.id, to, `${s.y} swap right`) : `<span class="chk" aria-hidden="true">✓</span>`}</div>
      <div class="pnote"><b>How it works:</b> ${esc(E.pickTerms(L.picks[s.pick] || {note: s.note, also: [], tags: ""}) || `May trade their ${s.y} pick for the ${team(s.grantor)?.short} pick if it's better.`)}</div></div>`;
  };
  const inDeal = picks.filter(k => L.psel[k.id] || L.wsel[newKey(k)]).length + swaps.filter(s => L.wsel[s.id]).length;
  const body = open ? [...picks.map(row), ...swaps.map(srow)].join("") || `<div class="sub" style="padding:6px 4px">No picks left to trade.</div>`
    : [...picks.filter(k => L.psel[k.id] || L.wsel[newKey(k)]).map(row), ...swaps.filter(s => L.wsel[s.id]).map(srow)].join("");
  return `<div class="pks"><button class="pkhead" data-pkopen="${ab}" aria-expanded="${open}"><span><b>Draft picks</b> · ${firsts} first${firsts === 1 ? "" : "s"}, ${picks.length - firsts} second${picks.length - firsts === 1 ? "" : "s"}${swaps.length ? `, ${swaps.length} swap right${swaps.length > 1 ? "s" : ""}` : ""}</span>${inDeal ? `<span class="pill info" style="color:var(--sel)">${inDeal} in deal</span>` : ""}<span class="car">${open ? "▴" : "▾"}</span></button>
    ${body ? `<div class="pklist">${body}</div>` : ""}</div>`;
}
function capTools(ab) {
  const hc = L.hardcap[ab], tpes = E.teamTPEs(ab), sent = L.cashSent[ab] || 0, recv = L.cashRecv[ab] || 0, c = L.csel[ab], others = L.teamIds.filter(x => x !== ab);
  const open = U.ctOpen[ab] ?? false;
  const summary = [hc ? `Hard cap: ${hc === 1 ? "1st" : "2nd"} apron` : "", tpes.length ? `${tpes.length} trade exception${tpes.length > 1 ? "s" : ""}` : "", c?.amt ? `${money(c.amt)} cash in deal` : ""].filter(Boolean).join(" · ") || "No hard cap or trade exceptions";
  const cashVal = c?.amt ? String(+(c.amt / 1e6).toFixed(3)) : "";
  return `<div class="pks ct"><button class="pkhead" data-ctopen="${ab}" aria-expanded="${open}"><span><b>Cap tools</b> · ${esc(summary)}</span><span class="car">${open ? "▴" : "▾"}</span></button>
    ${open ? `<div class="ctbody">
      <div class="ctrow"><span class="k">Hard cap</span><span>${hc ? `<span class="pill lock">${hc === 1 ? "1st" : "2nd"} apron · ${money(hc === 1 ? E.APRON1 : E.APRON2)}</span><div class="sub">Because of ${esc(L.hcWhy[ab] || "")}.</div>` : `<span class="sub">None yet. A trade can create one.</span>`}</span></div>
      <div class="ctrow"><span class="k">Trade exceptions</span><span>${tpes.length ? tpes.map(x => `<div class="tpe"><b class="mono">${money(x.amt, 2)}</b> from ${esc(x.from)} <span class="sub">· expires ${fmtD(x.end)}</span></div>`).join("") : `<span class="sub">None open on ${fmtD(L.date)}.</span>`}<div class="sub">Used automatically when a deal needs one: one incoming player per exception, only if the team stays under the first apron.</div></span></div>
      <div class="ctrow"><span class="k">Cash</span><span><div class="sub">Sent ${money(sent, 2)}, received ${money(recv, 2)}. Limit is ${money(E.CASH_LIMIT, 3)} each way this season.</div>
        ${others.length ? `<div class="cashin"><label for="cash-${ab}">Send $</label><input id="cash-${ab}" type="number" min="0" step="0.1" inputmode="decimal" data-cash="${ab}" value="${cashVal}" placeholder="0"><span>M to</span><select data-cashto="${ab}" aria-label="Team receiving the cash">${others.map(o => `<option value="${o}" ${o === (c?.to || others[0]) ? "selected" : ""}>${esc(team(o).short)}</option>`).join("")}</select></div>` : ""}</span></div>
    </div>` : ""}</div>`;
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
    const li = (arr, pk, sw, cash) => arr.length || pk.length || sw.length || cash ? (cash ? `<div><span>Cash</span><span class="mono">${money(cash, 2)}</span></div>` : "") + arr.map(p => `<div><span>${esc(p.name)}</span><span class="mono">${p.twoway ? "two-way" : money(p.sal)}</span></div>`).join("") +
      pk.map(k => `<div><span>${esc(E.pickLabel(k))} pick</span><span class="mono" style="color:var(--mute)">${E.isConditional(k) ? "conditional" : "pick"}</span></div>`).join("") +
      sw.map(w => `<div><span>${w.y} ${w.r === 1 ? "1st" : "2nd"} swap (${esc(team(w.grantor)?.short || w.grantor)} pick)</span><span class="mono" style="color:var(--mute)">${w.isNew ? "new" : w.to === w.grantor ? "cancels it" : "swap"}</span></div>`).join("")
      : `<div><span style="color:var(--faint)">Nothing</span></div>`;
    const bad = ev.issues.some(i => i.kind === "salary" && i.team === ab);
    return `<div class="tsum"><h3><span class="dot" style="background:${t.color}"></span>${esc(t.short)}</h3>
      <div class="lst"><div class="k">Receive</div>${li(s.inc, s.pIn, s.wIn, s.cashIn)}<div class="k">Send</div>${li(s.out, s.pOut, s.wOut, s.cashOut)}</div>
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
  <p><b>2026-27:</b> cap ${money(E.CAP, 3)} · tax ${money(E.TAX, 3)} · 1st apron ${money(E.APRON1, 3)} · 2nd apron ${money(E.APRON2, 3)}. The trade deadline is Feb 11, 2027 at 3 p.m. ET. Matching bands follow the CBA formula; the Finals end and draft dates are estimates. Payroll is each team's official cap number: every standard contract plus dead money from waived players. <b>Picks:</b> 2027–${E.PICK_LAST} firsts and seconds; checks the Stepien rule (no back-to-back years without a first), the frozen ${E.PICK_LAST} first for second-apron teams, and the draft date. Protected, conditional and swap picks keep their terms, and each one says what it depends on. You can trade swap rights a team holds or offer a new swap on a pick a team owns (both teams must own that year's pick). <b>Cash, exceptions, hard caps:</b> cash is limited to ${money(E.CASH_LIMIT, 3)} sent and received per team this season, and second-apron teams can't send any. Trade exceptions (one player each, must stay under the first apron) are used automatically and expire after a year; a team that sends out more salary than it takes back while over the cap gets a new one. Hard caps from earlier moves come from Salary Swish's tracker, and the deal itself can add one: taking back more than 100% or using a trade exception (1st apron), combining salaries or sending cash (2nd apron). * = salary not found, minimum assumed.</p>
  <p>Data: rosters, heights, stats and transactions from ESPN; contracts, options, two-way deals and dead money from Salary Swish team cap sheets (Basketball-Reference as a backup); pick ownership from Salary Swish. Updated ${DATA ? new Date(DATA.updated).toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : ""}. <button class="btn ghost" data-view="${U.mode === "mobile" ? "desktop" : "mobile"}" style="padding:2px 8px;font-size:12px">Switch to ${U.mode === "mobile" ? "desktop" : "mobile"} layout</button></p>`;

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
  $("dBoard").innerHTML = L.teamIds.map(ab => `<article class="col">${thead(ab, true)}${capBox(ab, ev)}${capTools(ab)}${picksSection(ab)}${sortbar()}<div class="roster">${rosterIds(ab).map(card).join("")}</div></article>`).join("") +
    (n === 0 ? `<article class="col startcol">${teamGrid("Start a trade", "Choose the teams you want to trade between. You can also search for any player on the left.")}</article>`
      : n === 1 ? `<article class="col startcol">${teamGrid("Add a team to trade with", `Pick a partner for the ${esc(team(L.teamIds[0]).short)}. Trades can include up to 4 teams.`)}</article>` : "");
}
function dPanel(ev) {
  const [c, h, s] = verdict(ev);
  $("dPanel").innerHTML = `<div class="vhead"><div><div class="vtitle ${c}">${h}${c === "ok" ? " ✓" : ""}</div><div class="vsub">${s}</div></div></div>
    ${issuesHtml(ev)}
    <div class="actions"><button class="btn ${ev.state === "ok" ? "go" : "primary"}" data-exec ${ev.state === "idle" ? "disabled" : ""}>${ev.state === "ok" ? "Complete trade · save image" : "Save trade image"}</button><button class="btn" id="clearSel" ${ev.state === "idle" ? "disabled" : ""}>Clear</button></div>
    <p class="sub" style="margin:2px 0 8px">Completing a trade saves an image of it. The rosters stay as they really are.</p>
    ${summaryHtml(ev)}`;
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
  $("mTeams").innerHTML = L.teamIds.map(ab => { const t = team(ab), n = Object.keys(L.sel).filter(id => L.players[id].team === ab).length + Object.keys(L.psel).filter(id => L.picks[id].own === ab).length + Object.keys(L.wsel).filter(id => { const s = E.swapFromKey(id); return s && (s.isNew ? s.grantor : s.holder) === ab; }).length, on = U.mview === "roster" && ab === U.mteam;
    return `<button class="tchip ${on ? "on" : ""}" data-mteam="${ab}" style="${on ? `background:${t.color}` : ""}"><span class="dot" style="background:${on ? "#fff" : t.color}"></span>${esc(t.short)}${n ? `<span class="ct">${n}</span>` : ""}</button>`; }).join("") +
    `<button class="tchip add" data-sheet="teams">+ Teams</button>`;
}
function mBody(ev) {
  const b = $("mBody");
  if (U.mview === "roster") {
    const ab = U.mteam;
    if (!ab) { b.innerHTML = `<div class="m-section">${teamGrid("Start a trade", "Pick the teams you want to trade between. You can also find any player in Search.")}</div>`; return; }
    b.innerHTML = `<div class="m-thead">${thead(ab, false)}${capBox(ab, ev)}${capTools(ab)}${picksSection(ab)}</div>${L.teamIds.length < 2 ? `<div class="m-section" style="margin-top:12px">${teamGrid("Add a team to trade with", "")}</div>` : ""}${sortbar()}<div class="roster">${rosterIds(ab).map(card).join("")}</div>`;
  } else if (U.mview === "search") {
    b.innerHTML = `<div class="m-section"><h2>Find any player</h2><div class="sbox"><input id="mq" type="search" placeholder="Name, e.g. Tatum" value="${esc(U.q)}" autocomplete="off" enterkeyhint="search"></div><div id="mRes">${searchList(false)}</div>${U.q ? "" : `<p class="sub" style="margin:10px 2px 0">Tap a result to add him to the trade. His team joins the deal if it isn't in it yet.</p>`}</div>`;
  } else {
    const [c, h, s] = verdict(ev);
    b.innerHTML = `<div class="m-section"><div class="vtitle ${c}">${h}${c === "ok" ? " ✓" : ""}</div><div class="vsub">${s}</div>
      ${ev.issues.length || ev.warns.length ? `<div style="margin-top:12px">${issuesHtml(ev)}</div>` : ""}
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn ${ev.state === "ok" ? "go" : "primary"}" data-exec style="flex:1;padding:11px" ${ev.state === "idle" ? "disabled" : ""}>${ev.state === "ok" ? "Complete trade · save image" : "Save trade image"}</button><button class="btn" id="clearSel" style="padding:11px" ${ev.state === "idle" ? "disabled" : ""}>Clear</button></div></div>
      <div class="m-section">${summaryHtml(ev)}</div>
      <div class="sub" style="padding:4px 2px 12px">${footHtml()}</div>`;
  }
}
function mDock(ev) {
  const [c, h] = verdict(ev), n = Object.keys(L.sel).length + Object.keys(L.psel).length + Object.keys(L.wsel).length + Object.values(L.csel).filter(c => c.amt > 0).length;
  const detail = ev.state === "bad" ? ev.issues[0].h : ev.state === "ok" ? `${n} asset${n > 1 ? "s" : ""} move` : L.teamIds.length < 2 ? "Pick at least 2 teams" : "Tap players or picks to add them";
  $("mDock").innerHTML = (U.mview !== "trade" ? `<button class="m-verdict" data-mview="trade"><span class="vt ${c}">${h}</span><span class="vd">${esc(detail)}</span>${ev.state !== "idle" ? `<span class="btn ${ev.state === "ok" ? "go" : ""}" data-exec>Save image</span>` : ""}</button>` : "") +
    `<div class="m-tabs" role="tablist">${[["roster", "Rosters"], ["search", "Search"], ["trade", "Trade"]].map(([k, l]) => `<button role="tab" aria-selected="${U.mview === k}" class="${U.mview === k ? "on" : ""}" data-mview="${k}">${ICON[k]}${l}${k === "trade" && n ? `<span class="badge ${ev.state}">${n}</span>` : ""}</button>`).join("")}</div>`;
}
function mSheet() {
  const el = $("mSheet");
  if (!U.sheet || U.sheet === "shot") { el.innerHTML = ""; return; }
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
function renderShot() {
  let el = $("shotModal");
  if (U.sheet !== "shot" || !shot) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "shotModal"; document.body.appendChild(el); }
  el.innerHTML = `<div class="sheet-bg" data-shotclose></div><div class="shot" role="dialog" aria-label="Trade image">
    <div class="shot-head"><h3>Trade image</h3><button class="tx-x shotx" data-shotclose aria-label="Close">×</button></div>
    <div class="shot-img"><img src="${shot.url}" alt="Image of this trade with players, picks, contracts and cap details"></div>
    <div class="shot-actions"><button class="btn go" data-shotdl>Download PNG</button><button class="btn" data-shotclose>Close</button></div>
    <p class="sub">If the download doesn\x27t start, press and hold (or right-click) the image and choose Save. The rosters haven\x27t changed.</p></div>`;
}
function render(keepSlider) {
  const mode = U.force || (mq.matches ? "mobile" : "desktop");
  if (mode !== U.mode) { U.mode = mode; mode === "mobile" ? mobileShell() : desktopShell(); keepSlider = false; }
  mode === "mobile" ? renderMobile(keepSlider) : renderDesktop(keepSlider);
  renderShot();
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
    for (const [id, to] of Object.entries(L.wsel)) { const s = E.swapFromKey(id); if (to === ab || (s.isNew ? s.grantor : s.holder) === ab) delete L.wsel[id]; }
    for (const [from, c] of Object.entries(L.csel)) if (from === ab || c.to === ab) delete L.csel[from];
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
function toggleSwap(key) {
  if (L.wsel[key]) delete L.wsel[key];
  else {
    const s = E.swapFromKey(key), from = s.isNew ? s.grantor : s.holder;
    const dest = L.teamIds.find(x => x !== from);
    if (!dest) return toast("Pick a second team to send the swap to.");
    L.wsel[key] = dest;
  }
  render();
}
// ---------- trade image ----------
// Completing a trade never changes the rosters. It draws a shareable image of the deal with everything that matters.
const IMG = {bg: "#0f1319", panel: "#171c24", panel2: "#1d232d", line: "#2b3340", ink: "#e8ecf1", mute: "#9aa4b2", faint: "#6c7685",
  accent: "#f08a3c", ok: "#4cc683", bad: "#ff6b63", warn: "#e8b04a", sel: "#6d9dff"};
const F = {disp: '"Barlow Condensed", "Arial Narrow", sans-serif', body: '"IBM Plex Sans", system-ui, sans-serif', mono: '"IBM Plex Mono", ui-monospace, monospace'};
const dlCap = window.claude?.use ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const poss = s => s.endsWith("s") ? s + "\x27" : s + "\x27s";
function drawTrade(ev, ctx, W, colH) {
  // Returns the height used. Called once to measure (ctx draws off-screen) and once to paint.
  const pad = 40, n = L.teamIds.length, gap = 18, colW = (W - pad * 2 - gap * (n - 1)) / n;
  const [vc, vh] = verdict(ev);
  const text = (s, x, y, font, color, align = "left") => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y); };
  const para = (s, x, y, w, font, color, lh) => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = "left"; for (const l of wrapLines(ctx, s, w)) { ctx.fillText(l, x, y); y += lh; } return y; };
  ctx.fillStyle = IMG.bg; ctx.fillRect(0, 0, W, 20000);
  // header
  let y = pad + 30;
  text("TRADE", pad, y, `800 38px ${F.disp}`, IMG.ink);
  ctx.font = `800 38px ${F.disp}`; const tw = ctx.measureText("TRADE ").width;
  text("DESK", pad + tw, y, `800 38px ${F.disp}`, IMG.accent);
  const badge = vc === "ok" ? "TRADE WORKS ✓" : vc === "bad" ? "TRADE DOESN'T WORK" : "TRADE IDEA";
  ctx.font = `800 26px ${F.disp}`; const bw = ctx.measureText(badge).width + 32;
  ctx.fillStyle = vc === "ok" ? "rgba(76,198,131,.16)" : "rgba(255,107,99,.16)"; ctx.beginPath(); ctx.roundRect(W - pad - bw, y - 30, bw, 42, 8); ctx.fill();
  text(badge, W - pad - bw / 2, y, `800 26px ${F.disp}`, vc === "ok" ? IMG.ok : IMG.bad, "center");
  y += 30;
  text(L.teamIds.map(ab => team(ab).name).join("  ⇄  "), pad, y, `600 20px ${F.body}`, IMG.ink);
  y += 26;
  text(`League date ${L.date.toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric", year: "numeric"})} · ${DATA.season} season · ${verdict(ev)[2]}`, pad, y, `400 15px ${F.body}`, IMG.mute);
  y += 26;
  // team columns
  const top = y; let maxBottom = y; const heights = [];
  L.teamIds.forEach((ab, i) => {
    const t = team(ab), s = ev.summary[ab], x = pad + i * (colW + gap), inner = colW - 28;
    let cy = top;
    const blockTop = cy;
    if (colH) { ctx.fillStyle = IMG.panel; ctx.beginPath(); ctx.roundRect(x, blockTop, colW, colH[i], 12); ctx.fill(); }
    ctx.fillStyle = t.color; ctx.beginPath(); ctx.roundRect(x, cy, colW, 64, [12, 12, 0, 0]); ctx.fill();
    text(`${t.loc} · ${t.record || "0-0"}`, x + 14, cy + 22, `500 13px ${F.body}`, "rgba(255,255,255,.85)");
    text(t.short.toUpperCase(), x + 14, cy + 52, `700 30px ${F.disp}`, "#fff");
    cy += 64 + 22;
    const sect = label => { text(label, x + 14, cy, `700 12px ${F.body}`, IMG.mute); cy += 8; ctx.fillStyle = IMG.line; ctx.fillRect(x + 14, cy, inner, 1); cy += 20; };
    sect("RECEIVES");
    const got = s.inc.length + s.pIn.length + s.wIn.length + (s.cashIn ? 1 : 0);
    if (!got) { text("Nothing", x + 14, cy, `400 15px ${F.body}`, IMG.faint); cy += 26; }
    for (const p of s.inc) {
      text(p.name, x + 14, cy, `600 18px ${F.body}`, IMG.ink);
      if (n > 2) text(`from ${team(L.teamIds.find(a => ev.summary[a].out.includes(p))).short}`, x + 14 + inner, cy, `400 12px ${F.body}`, IMG.mute, "right");
      cy += 21;
      cy = para(`${p.pos} · ${p.ht} · ${p.wt} · Age ${p.age ?? "—"} · ${p.exp ? p.exp + " yrs exp" : "Rookie"}`, x + 14, cy, inner, `400 13.5px ${F.body}`, IMG.mute, 18);
      if (p.st) cy = para(`${p.st[2].toFixed(1)} PTS  ${p.st[3].toFixed(1)} REB  ${p.st[4].toFixed(1)} AST  ${p.st[5].toFixed(1)} FG%  ${p.st[6].toFixed(1)} 3P%  (${p.st[0]} GP)`, x + 14, cy, inner, `500 13px ${F.mono}`, IMG.ink, 18);
      const oi = p.years.findIndex(v => v.opt);
      const con = p.twoway ? "Two-way contract" : `${money(p.sal, 2)} · ${p.yrs} yr${p.yrs === 1 ? "" : "s"}${p.yrs ? " thru " + E.SEASONS[Math.min(p.yrs, 6) - 1] : ""}${oi >= 0 ? ` · ${p.years[oi].opt === "P" ? "player" : p.years[oi].opt === "T" ? "team" : "early-termination"} option ${E.SEASONS[oi]}` : ""}${p.ntc ? " · can veto trades" : ""}`;
      cy = para(con, x + 14, cy, inner, `600 13.5px ${F.mono}`, IMG.accent, 18);
      cy += 10;
    }
    for (const k of s.pIn) {
      text(`${k.y} ${k.r === 1 ? "first" : "second"}-round pick`, x + 14, cy, `600 17px ${F.body}`, IMG.ink);
      text(k.orig === ab ? "their own" : `${poss(team(k.orig).short)} pick`, x + 14 + inner, cy, `400 12px ${F.body}`, IMG.mute, "right"); cy += 20;
      if (E.isConditional(k)) cy = para(E.pickTerms(k), x + 14, cy, inner, `400 13px ${F.body}`, IMG.warn, 17);
      else cy = para("No protections or conditions.", x + 14, cy, inner, `400 13px ${F.body}`, IMG.mute, 17);
      cy += 8;
    }
    for (const w of s.wIn) {
      text(`${w.y} ${w.r === 1 ? "1st" : "2nd"}-round swap rights`, x + 14, cy, `600 17px ${F.body}`, IMG.ink); cy += 20;
      cy = para(w.isNew ? `New swap: the ${t.short} may trade their own ${w.y} pick for the ${poss(team(w.grantor).short)} if that one is better (earlier).`
        : E.pickTerms(L.picks[w.pick] || {note: w.note, also: [], tags: ""}), x + 14, cy, inner, `400 13px ${F.body}`, IMG.sel, 17);
      cy += 8;
    }
    if (s.cashIn) { text(`${money(s.cashIn, 2)} cash`, x + 14, cy, `600 17px ${F.body}`, IMG.ink); cy += 26; }
    cy += 6; sect("SENDS");
    const sent = [...s.out.map(p => `${p.name} (${p.twoway ? "two-way" : money(p.sal)})`), ...s.pOut.map(k => `${E.pickLabel(k)} pick`), ...s.wOut.map(w => `${w.y} swap rights`), ...(s.cashOut ? [`${money(s.cashOut, 2)} cash`] : [])];
    cy = para(sent.length ? sent.join(", ") : "Nothing", x + 14, cy, inner, `400 14px ${F.body}`, sent.length ? IMG.ink : IMG.faint, 19);
    cy += 10; sect("CAP SHEET");
    const row = (k, v, col = IMG.ink) => { text(k, x + 14, cy, `400 13.5px ${F.body}`, IMG.mute); text(v, x + 14 + inner, cy, `600 13.5px ${F.mono}`, col, "right"); cy += 20; };
    row("Salary out / in", `${money(s.outV)} / ${money(s.inV)}`);
    if (s.before != null) {
      row("Payroll", `${money(s.before)} → ${money(s.after)}`);
      row("Tier after", E.TIER[E.tierOf(s.after)], s.after > E.APRON1 ? IMG.bad : s.after > E.TAX ? IMG.warn : IMG.ink);
      row("Roster (standard)", `${s.std[0]} → ${s.std[1]}`);
      if (s.hardcap) row("Hard cap", `${s.hardcap === 1 ? "1st" : "2nd"} apron`, IMG.warn);
    }
    if (s.rule) { cy += 2; cy = para(s.rule, x + 14, cy, inner, `400 12.5px ${F.body}`, ev.issues.some(q => q.kind === "salary" && q.team === ab) ? IMG.bad : IMG.ok, 17); }
    cy += 14;
    heights[i] = cy - blockTop;
    maxBottom = Math.max(maxBottom, cy);
  });
  y = maxBottom + 26;
  // problems and notes
  const notes = [...ev.issues.map(q => ["bad", q]), ...ev.warns.filter(w => !/depends on other results/.test(w.h)).map(w => ["warn", w])];
  if (notes.length) {
    text(ev.issues.length ? "WHY IT DOESN'T WORK" : "THINGS TO KNOW", pad, y, `700 13px ${F.body}`, IMG.mute); y += 22;
    for (const [kind, q] of notes) {
      text("●", pad, y, `700 14px ${F.body}`, kind === "bad" ? IMG.bad : IMG.warn);
      y = para(q.h, pad + 20, y, W - pad * 2 - 20, `600 16px ${F.body}`, IMG.ink, 21);
      y = para(q.p, pad + 20, y, W - pad * 2 - 20, `400 14px ${F.body}`, IMG.mute, 19) + 10;
    }
  }
  y += 8; ctx.fillStyle = IMG.line; ctx.fillRect(pad, y, W - pad * 2, 1); y += 24;
  const up = new Date(DATA.updated);
  y = para(`NBA Trade Desk · rosters and contracts as of ${up.toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"})} · 2026-27 cap ${money(E.CAP, 1)}, tax ${money(E.TAX, 1)}, aprons ${money(E.APRON1, 1)} / ${money(E.APRON2, 1)} · sources: ESPN, Salary Swish, Basketball-Reference`, pad, y, W - pad * 2, `400 12.5px ${F.body}`, IMG.faint, 17);
  return {h: y + pad - 10, heights};
}
async function buildTradeImage(ev) {
  await Promise.all([`800 38px ${F.disp}`, `600 18px ${F.body}`, `400 14px ${F.body}`, `600 13px ${F.mono}`].map(f => document.fonts?.load(f).catch(() => null)));
  const W = L.teamIds.length > 3 ? 1500 : 1200, scale = 2;
  const m = document.createElement("canvas").getContext("2d");
  m.canvas.width = W; m.canvas.height = 10;
  const first = drawTrade(ev, m, W), H = Math.ceil(first.h);
  const c = document.createElement("canvas"); c.width = W * scale; c.height = H * scale;
  const ctx = c.getContext("2d"); ctx.scale(scale, scale);
  ctx.fillStyle = IMG.bg; ctx.fillRect(0, 0, W, H);
  drawTrade(ev, ctx, W, first.heights);
  return c;
}
let shot = null;
async function execute() {
  const ev = E.evaluate(); if (ev.state === "idle") return;
  toast("Making the trade image…");
  const canvas = await buildTradeImage(ev);
  const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
  const name = `trade-${L.teamIds.map(ab => team(ab).short.toLowerCase().replace(/[^a-z0-9]+/g, "-")).join("-")}-${L.date.toISOString().slice(0, 10)}.png`;
  if (shot?.url) URL.revokeObjectURL(shot.url);
  shot = {blob, name, url: URL.createObjectURL(blob)};
  U.sheet = "shot"; render();
}
async function downloadShot() {
  if (!shot) return;
  const dl = await dlCap;
  if (dl) {
    try { await dl.save({filename: shot.name, data: shot.blob}); toast("Trade image saved."); }
    catch (e) { if (e?.code !== "declined") toast("Couldn't save here. Press and hold (or right-click) the image to save it."); }
    return;
  }
  const a = document.createElement("a"); a.href = shot.url; a.download = shot.name; document.body.appendChild(a); a.click(); a.remove();
  toast("Trade image downloaded.");
}

document.addEventListener("click", e => {
  const el = e.target.closest("[data-pid],[data-pick],[data-swap],[data-newswap],[data-pkopen],[data-ctopen],[data-go],[data-addd],[data-rm],[data-sort],[data-exec],[data-team],[data-open],[data-find],[data-addp],[data-mteam],[data-mview],[data-sheet],[data-close],[data-view],[data-shotdl],[data-shotclose],#clearSel,select,input");
  if (!el || el.matches("select,input")) return;
  if (el.dataset.open) { e.stopPropagation(); U.open[el.dataset.open] = !U.open[el.dataset.open]; return render(); }
  if (el.dataset.exec !== undefined) { e.stopPropagation(); return execute(); }
  if (el.dataset.shotdl !== undefined) return downloadShot();
  if (el.dataset.shotclose !== undefined) { U.sheet = null; return render(); }
  if (el.dataset.pid) return togglePlayer(el.dataset.pid);
  if (el.dataset.pick) return togglePick(el.dataset.pick);
  if (el.dataset.swap) return toggleSwap(el.dataset.swap);
  if (el.dataset.newswap) return toggleSwap(el.dataset.newswap);
  if (el.dataset.pkopen) { const ab = el.dataset.pkopen; U.pkOpen[ab] = !(U.pkOpen[ab] ?? false); return render(); }
  if (el.dataset.ctopen) { const ab = el.dataset.ctopen; U.ctOpen[ab] = !(U.ctOpen[ab] ?? false); return render(); }
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
  if (el.id === "clearSel") { L.sel = {}; L.psel = {}; L.wsel = {}; L.csel = {}; return render(); }
});
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.dataset?.pid) { e.preventDefault(); togglePlayer(e.target.dataset.pid); }
  if ((e.key === "Enter" || e.key === " ") && e.target.dataset?.pick) { e.preventDefault(); togglePick(e.target.dataset.pick); }
  if ((e.key === "Enter" || e.key === " ") && (e.target.dataset?.swap || e.target.dataset?.newswap)) { e.preventDefault(); toggleSwap(e.target.dataset.swap || e.target.dataset.newswap); }
  if (e.key === "Escape" && U.sheet) { U.sheet = null; render(); }
});
document.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.dest) { L.sel[el.dataset.dest] = el.value; render(); }
  if (el.dataset.pdest) { L.psel[el.dataset.pdest] = el.value; render(); }
  if (el.dataset.wdest) { L.wsel[el.dataset.wdest] = el.value; render(); }
  if (el.dataset.cash) { const ab = el.dataset.cash, amt = Math.max(0, Math.round((parseFloat(el.value) || 0) * 1e6)); const to = L.csel[ab]?.to || L.teamIds.find(x => x !== ab); if (amt) L.csel[ab] = {to, amt}; else delete L.csel[ab]; render(); }
  if (el.dataset.cashto) { const ab = el.dataset.cashto; if (L.csel[ab]) L.csel[ab].to = el.value; else L.csel[ab] = {to: el.value, amt: 0}; render(); }
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
  E.load(data, []);   // trades never change the real rosters
  try { localStorage.removeItem("tdesk.trades"); } catch {}
  L.teamIds = [];
  U.mteam = null;
  render();
}).catch(err => { $("app").innerHTML = `<div class="loading">Couldn't load roster data (${esc(err.message)}). Reload the page to try again.</div>`; });
})();
